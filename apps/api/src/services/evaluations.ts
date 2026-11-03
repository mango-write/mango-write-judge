import { createHash } from "node:crypto";

import { evaluationPermission, type CriterionWeight } from "@mango-write-judge/domain";
import type { SubmitScoresResponseDto } from "@mango-write-judge/contracts";

import { generateId } from "../auth/tokens";
import type { Sql, Tx } from "../db/client";
import { AppError, notFound } from "../http/errors";
import { hub } from "../realtime/hub";
import { bumpRevision, insertAudit, lockEvent } from "./shared";

export interface EvaluationRow {
  id: string;
  event_id: string;
  judge_id: string;
  project_id: string;
  status: "draft" | "submitted";
  version: number;
  submitted_at: Date | null;
}

async function loadCriteria(tx: Tx, eventId: string): Promise<CriterionWeight[]> {
  return tx<CriterionWeight[]>`
    SELECT id, weight_percent AS "weightPercent" FROM criteria
    WHERE event_id = ${eventId} ORDER BY position`;
}

function validateScoreKeys(scores: Record<string, number>, criteria: CriterionWeight[]): void {
  const known = new Set(criteria.map((c) => c.id));
  for (const key of Object.keys(scores)) {
    if (!known.has(key)) {
      throw new AppError("validation_error", `未知的评分项：${key}`, { criterionId: key });
    }
  }
}

async function ensureEvaluation(
  tx: Tx,
  input: { eventId: string; judgeId: string; projectId: string },
): Promise<EvaluationRow> {
  const existing = await tx<EvaluationRow[]>`
    SELECT id, event_id, judge_id, project_id, status, version, submitted_at
      FROM evaluations WHERE judge_id = ${input.judgeId} AND project_id = ${input.projectId}`;
  if (existing[0]) return existing[0];
  await tx`
    INSERT INTO evaluations (id, event_id, judge_id, project_id)
    VALUES (${generateId()}, ${input.eventId}, ${input.judgeId}, ${input.projectId})
    ON CONFLICT (judge_id, project_id) DO NOTHING`;
  const rows = await tx<EvaluationRow[]>`
    SELECT id, event_id, judge_id, project_id, status, version, submitted_at
      FROM evaluations WHERE judge_id = ${input.judgeId} AND project_id = ${input.projectId}`;
  if (!rows[0]) throw new AppError("internal_error", "评分行创建失败");
  return rows[0];
}

async function hasActiveUnlock(tx: Tx, evaluationId: string): Promise<boolean> {
  const rows = await tx`
    SELECT 1 FROM evaluation_unlocks
     WHERE evaluation_id = ${evaluationId} AND revoked_at IS NULL AND used_at IS NULL`;
  return rows.length > 0;
}

async function replaceItems(tx: Tx, evaluationId: string, scores: Record<string, number>): Promise<void> {
  await tx`DELETE FROM evaluation_items WHERE evaluation_id = ${evaluationId}`;
  for (const [criterionId, scoreTenths] of Object.entries(scores)) {
    await tx`
      INSERT INTO evaluation_items (evaluation_id, criterion_id, score_tenths)
      VALUES (${evaluationId}, ${criterionId}, ${scoreTenths})`;
  }
}

interface WriteContext {
  evaluation: EvaluationRow;
  criteria: CriterionWeight[];
  revealed: boolean;
}

/** 评分写事务的公共前置：资源归属（404）→ 状态 → 解锁 → 评分项 → 评分行。 */
async function prepareScoreWrite(
  tx: Tx,
  input: { eventId: string; judgeId: string; projectId: string; scores: Record<string, number> },
): Promise<WriteContext> {
  const project = await tx<{ id: string; unlocked_at: Date | null }[]>`
    SELECT id, unlocked_at FROM projects WHERE id = ${input.projectId} AND event_id = ${input.eventId}`;
  if (!project[0]) throw notFound("项目不存在");
  const event = await lockEvent(tx, input.eventId);
  if (event.status !== "judging") {
    throw new AppError(
      event.status === "closed" ? "event_closed" : "event_not_draft",
      event.status === "closed" ? "比赛已闭幕，全部锁定" : "比赛尚未启动",
    );
  }
  if (!project[0].unlocked_at) throw new AppError("forbidden", "项目尚未解锁，暂不能评分");
  const criteria = await loadCriteria(tx, input.eventId);
  validateScoreKeys(input.scores, criteria);
  const evaluation = await ensureEvaluation(tx, input);
  return { evaluation, criteria, revealed: event.revealed_at != null };
}

function guardPermission(
  ctx: { evaluation: EvaluationRow },
  event: { status: string; revealed: boolean },
  unlocked: boolean,
  need: "canSaveDraft" | "canSubmit",
): void {
  const permission = evaluationPermission({
    eventStatus: event.status as "draft" | "judging" | "closed",
    projectUnlocked: true,
    revealed: event.revealed,
    submittedVersion: ctx.evaluation.version,
    hasValidUnlock: unlocked,
  });
  if (permission[need]) return;
  if (permission.lockedByReveal) {
    throw new AppError("evaluation_unlock_required", "该评分需要管理员解锁后修改");
  }
  throw new AppError("forbidden", "当前状态不允许该操作");
}

/** 全量保存草稿：不推进公共 revision，不产生审计版本。 */
export async function saveDraft(
  sql: Sql,
  input: {
    eventId: string;
    judgeId: string;
    projectId: string;
    scores: Record<string, number>;
    expectedVersion: number;
  },
): Promise<{ version: number }> {
  return sql.begin(async (tx) => {
    const { evaluation, revealed } = await prepareScoreWrite(tx, input);
    guardPermission(
      { evaluation },
      { status: "judging", revealed },
      await hasActiveUnlock(tx, evaluation.id),
      "canSaveDraft",
    );
    if (evaluation.version !== input.expectedVersion) {
      throw new AppError("revision_conflict", "评分版本已变化，请刷新后重试");
    }
    await replaceItems(tx, evaluation.id, input.scores);
    await tx`UPDATE evaluations SET updated_at = now() WHERE id = ${evaluation.id}`;
    return { version: evaluation.version };
  });
}

function payloadHashOf(scores: Record<string, number>, expectedVersion: number): string {
  const canonical = JSON.stringify({
    expectedVersion,
    scores: Object.keys(scores).sort().map((key) => [key, scores[key]]),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * 正式提交：完整版本快照 + 幂等 + 解锁消费，事务内推进 revision，
 * 提交后 publish。提交时间以服务端时钟为准（响应与快照一致）。
 */
export async function submitScores(
  sql: Sql,
  input: {
    eventId: string;
    judgeId: string;
    projectId: string;
    scores: Record<string, number>;
    expectedVersion: number;
    operationId: string;
  },
): Promise<SubmitScoresResponseDto> {
  const response = await sql.begin(async (tx): Promise<SubmitScoresResponseDto> => {
    const { evaluation, criteria, revealed } = await prepareScoreWrite(tx, input);
    const unlocked = await hasActiveUnlock(tx, evaluation.id);
    const payloadHash = payloadHashOf(input.scores, input.expectedVersion);

    // 幂等：同一 operationId 的重试返回缓存响应；载荷不一致视为冲突。
    const command = await tx<{ payload_hash: string; response_json: SubmitScoresResponseDto }[]>`
      SELECT payload_hash, response_json FROM evaluation_commands
      WHERE evaluation_id = ${evaluation.id} AND operation_id = ${input.operationId}`;
    if (command[0]) {
      if (command[0].payload_hash !== payloadHash) {
        throw new AppError("idempotency_conflict", "同一 operationId 已用于不同载荷");
      }
      return command[0].response_json;
    }

    const missing = criteria.filter((c) => input.scores[c.id] === undefined).map((c) => c.id);
    if (missing.length > 0) {
      throw new AppError("incomplete_scores", "评分不完整，请填写全部评分项", { missing });
    }
    guardPermission({ evaluation }, { status: "judging", revealed }, unlocked, "canSubmit");
    if (evaluation.version !== input.expectedVersion) {
      throw new AppError("revision_conflict", "评分版本已变化，请刷新后重试");
    }

    const newVersion = evaluation.version + 1;
    const submittedAt = new Date();
    await replaceItems(tx, evaluation.id, input.scores);
    await tx`
      INSERT INTO evaluation_revisions (id, evaluation_id, version, items, content_hash, submitted_at)
      VALUES (${generateId()}, ${evaluation.id}, ${newVersion}, ${tx.json(input.scores as never)},
              ${payloadHash}, ${submittedAt.toISOString()})`;
    await tx`
      UPDATE evaluations SET status = 'submitted', version = ${newVersion},
             submitted_at = ${submittedAt.toISOString()}, updated_at = now()
      WHERE id = ${evaluation.id}`;
    // 提交成功即消费解锁：一次性解锁，改交后立即重新锁定
    await tx`
      UPDATE evaluation_unlocks SET used_at = now()
      WHERE evaluation_id = ${evaluation.id} AND revoked_at IS NULL AND used_at IS NULL`;
    const revision = await bumpRevision(tx, input.eventId);
    const result: SubmitScoresResponseDto = {
      version: newVersion,
      submittedAt: submittedAt.toISOString(),
      revision,
    };
    await tx`
      INSERT INTO evaluation_commands (evaluation_id, operation_id, payload_hash, response_json)
      VALUES (${evaluation.id}, ${input.operationId}, ${payloadHash}, ${tx.json(result as never)})`;
    return result;
  });
  hub.publish(input.eventId, response.revision);
  return response;
}

/** 管理员单次解锁「评委 × 项目」的旧评分；同时最多一个有效解锁。 */
export async function unlockEvaluation(sql: Sql, eventId: string, evaluationId: string): Promise<{ revision: number }> {
  const revision = await sql.begin(async (tx): Promise<number> => {
    const event = await lockEvent(tx, eventId);
    if (event.status === "closed") throw new AppError("event_closed", "比赛已闭幕");
    if (event.status === "draft") throw new AppError("event_not_draft", "比赛尚未启动");
    const evaluation = await tx<EvaluationRow[]>`
      SELECT id, event_id, judge_id, project_id, status, version, submitted_at
        FROM evaluations WHERE id = ${evaluationId} AND event_id = ${eventId}`;
    if (!evaluation[0]) throw notFound("评分不存在");
    if (evaluation[0].status !== "submitted") {
      throw new AppError("validation_error", "该评分尚未正式提交，无需解锁（首次提交不需要解锁）");
    }
    await tx`
      UPDATE evaluation_unlocks SET revoked_at = now()
      WHERE evaluation_id = ${evaluationId} AND revoked_at IS NULL AND used_at IS NULL`;
    await tx`INSERT INTO evaluation_unlocks (id, evaluation_id) VALUES (${generateId()}, ${evaluationId})`;
    await insertAudit(tx, eventId, "evaluation.unlock", {
      evaluationId,
      judgeId: evaluation[0].judge_id,
      projectId: evaluation[0].project_id,
    });
    return bumpRevision(tx, eventId);
  });
  hub.publish(eventId, revision);
  return { revision };
}

/** 撤销解锁：未提交的草稿不再允许正式提交，旧正式成绩保持有效。 */
export async function revokeUnlock(sql: Sql, eventId: string, evaluationId: string): Promise<{ revision: number }> {
  const revision = await sql.begin(async (tx): Promise<number> => {
    const event = await lockEvent(tx, eventId);
    if (event.status === "closed") throw new AppError("event_closed", "比赛已闭幕");
    if (event.status === "draft") throw new AppError("event_not_draft", "比赛尚未启动");
    const evaluation = await tx<{ id: string }[]>`
      SELECT id FROM evaluations WHERE id = ${evaluationId} AND event_id = ${eventId}`;
    if (!evaluation[0]) throw notFound("评分不存在");
    const rows = await tx`
      UPDATE evaluation_unlocks SET revoked_at = now()
      WHERE evaluation_id = ${evaluationId} AND revoked_at IS NULL AND used_at IS NULL
      RETURNING id`;
    if (!rows[0]) throw notFound("没有可撤销的有效解锁");
    await insertAudit(tx, eventId, "evaluation.unlock_revoke", { evaluationId });
    return bumpRevision(tx, eventId);
  });
  hub.publish(eventId, revision);
  return { revision };
}
