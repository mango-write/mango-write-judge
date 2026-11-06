import { MAX_CRITERIA } from "@mango-write-judge/domain";
import type { CsvImportResultDto, JudgeInviteDto } from "@mango-write-judge/contracts";

import { generateId, generateToken, hashToken } from "../auth/tokens";
import { revokeDisplaySessions, revokeJudgeSessions } from "../auth/session";
import type { Sql, Tx } from "../db/client";
import { AppError, notFound } from "../http/errors";
import { mapRows, parseCsv } from "../csv-parse";
import { hub } from "../realtime/hub";
import { bumpRevision, insertAudit, lockEvent } from "./shared";

export const MAX_PROJECTS = 200;
export const MAX_JUDGES = 100;

/** 草稿期配置写事务：锁行 → 状态与版本检查 → 写入 → revision+1（→ 审计）。 */
async function mutateConfig<T>(
  sql: Sql,
  eventId: string,
  expectedRevision: number,
  fn: (tx: Tx) => Promise<T>,
  allowDuringJudging = false,
): Promise<{ revision: number; value: T }> {
  const outcome = await sql.begin(async (tx): Promise<{ revision: number; value: T }> => {
    const event = await lockEvent(tx, eventId);
    if (event.status === "closed") throw new AppError("event_closed", "比赛已闭幕，配置冻结");
    if (!allowDuringJudging && event.status === "judging") {
      throw new AppError("event_not_draft", "比赛已启动，规则与名单已冻结");
    }
    if (event.revision !== expectedRevision) {
      throw new AppError("revision_conflict", "比赛配置已被其他操作修改，请刷新后重试");
    }
    const value = await fn(tx);
    const revision = await bumpRevision(tx, eventId);
    return { revision, value };
  });
  hub.publish(eventId, outcome.revision);
  return outcome;
}

// ---------- 评分项 ----------

export async function createCriterion(
  sql: Sql,
  eventId: string,
  input: { name: string; description: string; weightPercent: number; expectedRevision: number },
): Promise<number> {
  const { revision } = await mutateConfig(sql, eventId, input.expectedRevision, async (tx) => {
    const countRows = await tx<{ count: number }[]>`
      SELECT count(*)::int AS count FROM criteria WHERE event_id = ${eventId}`;
    if ((countRows[0]?.count ?? 0) >= MAX_CRITERIA) {
      throw new AppError("limit_exceeded", `评分项最多 ${MAX_CRITERIA} 个`);
    }
    const maxRows = await tx<{ max: number }[]>`
      SELECT COALESCE(MAX(position), 0)::int AS max FROM criteria WHERE event_id = ${eventId}`;
    await tx`
      INSERT INTO criteria (id, event_id, name, description, weight_percent, position)
      VALUES (${generateId()}, ${eventId}, ${input.name}, ${input.description},
              ${input.weightPercent}, ${(maxRows[0]?.max ?? 0) + 1})`;
  });
  return revision;
}

export async function patchCriterion(
  sql: Sql,
  eventId: string,
  criterionId: string,
  input: { name?: string; description?: string; weightPercent?: number; expectedRevision: number },
): Promise<number> {
  const { revision } = await mutateConfig(sql, eventId, input.expectedRevision, async (tx) => {
    const rows = await tx`SELECT id FROM criteria WHERE id = ${criterionId} AND event_id = ${eventId}`;
    if (!rows[0]) throw notFound("评分项不存在");
    await tx`
      UPDATE criteria SET name = COALESCE(${input.name ?? null}, name),
                          description = COALESCE(${input.description ?? null}, description),
                          weight_percent = COALESCE(${input.weightPercent ?? null}, weight_percent)
      WHERE id = ${criterionId}`;
  });
  return revision;
}

export async function deleteCriterion(
  sql: Sql,
  eventId: string,
  criterionId: string,
  expectedRevision: number,
): Promise<number> {
  const { revision } = await mutateConfig(sql, eventId, expectedRevision, async (tx) => {
    const rows = await tx`SELECT id FROM criteria WHERE id = ${criterionId} AND event_id = ${eventId}`;
    if (!rows[0]) throw notFound("评分项不存在");
    await tx`DELETE FROM criteria WHERE id = ${criterionId}`;
    await tx`
      WITH renumbered AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY position) AS pos
        FROM criteria WHERE event_id = ${eventId}
      )
      UPDATE criteria c SET position = r.pos FROM renumbered r WHERE c.id = r.id`;
  });
  return revision;
}

export async function reorderCriteria(
  sql: Sql,
  eventId: string,
  ids: string[],
  expectedRevision: number,
): Promise<number> {
  const { revision } = await mutateConfig(sql, eventId, expectedRevision, async (tx) => {
    const current = await tx<{ id: string }[]>`
      SELECT id FROM criteria WHERE event_id = ${eventId}`;
    const currentIds = new Set(current.map((c) => c.id));
    if (ids.length !== currentIds.size || ids.some((id) => !currentIds.has(id))) {
      throw new AppError("validation_error", "排序列表必须恰好包含全部评分项");
    }
    for (let index = 0; index < ids.length; index++) {
      await tx`UPDATE criteria SET position = ${index + 1} WHERE id = ${ids[index]!}`;
    }
  });
  return revision;
}

// ---------- 项目 ----------

export async function createProject(
  sql: Sql,
  eventId: string,
  input: { name: string; teamName: string; summary: string; expectedRevision: number },
): Promise<number> {
  const { revision } = await mutateConfig(sql, eventId, input.expectedRevision, async (tx) => {
    const countRows = await tx<{ count: number }[]>`
      SELECT count(*)::int AS count FROM projects WHERE event_id = ${eventId}`;
    if ((countRows[0]?.count ?? 0) >= MAX_PROJECTS) {
      throw new AppError("limit_exceeded", `项目最多 ${MAX_PROJECTS} 个`);
    }
    const maxRows = await tx<{ max: number }[]>`
      SELECT COALESCE(MAX(position), 0)::int AS max FROM projects WHERE event_id = ${eventId}`;
    await tx`
      INSERT INTO projects (id, event_id, name, team_name, summary, position)
      VALUES (${generateId()}, ${eventId}, ${input.name}, ${input.teamName}, ${input.summary},
              ${(maxRows[0]?.max ?? 0) + 1})`;
  }, true);
  return revision;
}

export async function patchProject(
  sql: Sql,
  eventId: string,
  projectId: string,
  input: { name?: string; teamName?: string; summary?: string; expectedRevision: number },
): Promise<number> {
  const { revision } = await mutateConfig(sql, eventId, input.expectedRevision, async (tx) => {
    const rows = await tx`SELECT id FROM projects WHERE id = ${projectId} AND event_id = ${eventId}`;
    if (!rows[0]) throw notFound("项目不存在");
    await tx`
      UPDATE projects SET name = COALESCE(${input.name ?? null}, name),
                          team_name = COALESCE(${input.teamName ?? null}, team_name),
                          summary = COALESCE(${input.summary ?? null}, summary)
      WHERE id = ${projectId}`;
  }, true);
  return revision;
}

export async function deleteProject(
  sql: Sql,
  eventId: string,
  projectId: string,
  expectedRevision: number,
): Promise<number> {
  const { revision } = await mutateConfig(sql, eventId, expectedRevision, async (tx) => {
    const rows = await tx`SELECT id FROM projects WHERE id = ${projectId} AND event_id = ${eventId}`;
    if (!rows[0]) throw notFound("项目不存在");
    await tx`DELETE FROM projects WHERE id = ${projectId}`;
    await tx`
      WITH renumbered AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY position) AS pos
        FROM projects WHERE event_id = ${eventId}
      )
      UPDATE projects p SET position = r.pos FROM renumbered r WHERE p.id = r.id`;
  });
  return revision;
}

export async function reorderProjects(
  sql: Sql,
  eventId: string,
  ids: string[],
  expectedRevision: number,
): Promise<number> {
  const { revision } = await mutateConfig(sql, eventId, expectedRevision, async (tx) => {
    const current = await tx<{ id: string }[]>`
      SELECT id FROM projects WHERE event_id = ${eventId}`;
    const currentIds = new Set(current.map((p) => p.id));
    if (ids.length !== currentIds.size || ids.some((id) => !currentIds.has(id))) {
      throw new AppError("validation_error", "排序列表必须恰好包含全部项目");
    }
    for (let index = 0; index < ids.length; index++) {
      await tx`UPDATE projects SET position = ${index + 1} WHERE id = ${ids[index]!}`;
    }
  }, true);
  return revision;
}

// ---------- 评委 ----------

export interface JudgeInviteRow {
  judgeId: string;
  name: string;
  token: string;
}

async function insertJudge(tx: Tx, eventId: string, name: string): Promise<JudgeInviteRow> {
  const token = generateToken();
  const id = generateId();
  await tx`
    INSERT INTO judges (id, event_id, name, invite_token, token_hash)
    VALUES (${id}, ${eventId}, ${name}, ${token}, ${hashToken(token)})`;
  return { judgeId: id, name, token };
}

export function judgeInviteUrl(inviteBaseUrl: string, slug: string, token: string): string {
  return `${inviteBaseUrl}/judge/${slug}#${token}`;
}

export function displayInviteUrl(inviteBaseUrl: string, slug: string, token: string): string {
  return `${inviteBaseUrl}/display/${slug}#${token}`;
}

export async function createJudge(
  sql: Sql,
  inviteBaseUrl: string,
  slug: string,
  eventId: string,
  input: { name: string; expectedRevision: number },
): Promise<JudgeInviteDto> {
  const { value, revision } = await mutateConfig(sql, eventId, input.expectedRevision, async (tx) => {
    const countRows = await tx<{ count: number }[]>`
      SELECT count(*)::int AS count FROM judges WHERE event_id = ${eventId}`;
    if ((countRows[0]?.count ?? 0) >= MAX_JUDGES) {
      throw new AppError("limit_exceeded", `评委最多 ${MAX_JUDGES} 名`);
    }
    return insertJudge(tx, eventId, input.name);
  }, true);
  return {
    id: value.judgeId,
    name: value.name,
    inviteUrl: judgeInviteUrl(inviteBaseUrl, slug, value.token),
    revision,
  };
}

export async function patchJudge(
  sql: Sql,
  eventId: string,
  judgeId: string,
  input: { name?: string; expectedRevision: number },
): Promise<number> {
  const { revision } = await mutateConfig(sql, eventId, input.expectedRevision, async (tx) => {
    const rows = await tx`SELECT id FROM judges WHERE id = ${judgeId} AND event_id = ${eventId}`;
    if (!rows[0]) throw notFound("评委不存在");
    await tx`UPDATE judges SET name = COALESCE(${input.name ?? null}, name) WHERE id = ${judgeId}`;
  }, true);
  return revision;
}

export async function deleteJudge(
  sql: Sql,
  eventId: string,
  judgeId: string,
  expectedRevision: number,
): Promise<number> {
  const { revision } = await mutateConfig(sql, eventId, expectedRevision, async (tx) => {
    const rows = await tx`SELECT id FROM judges WHERE id = ${judgeId} AND event_id = ${eventId}`;
    if (!rows[0]) throw notFound("评委不存在");
    await tx`DELETE FROM judges WHERE id = ${judgeId}`;
  });
  return revision;
}

/** 轮换评委链接：新 token 只返回一次，旧会话在事务提交后立即吊销。评审期可用（评委丢链接）。 */
export async function rotateJudgeToken(
  sql: Sql,
  inviteBaseUrl: string,
  eventId: string,
  judgeId: string,
): Promise<JudgeInviteDto> {
  const { value, revision } = await sql.begin(
    async (tx): Promise<{ value: JudgeInviteDto; revision: number }> => {
      const event = await lockEvent(tx, eventId);
      if (event.status === "closed") throw new AppError("event_closed", "比赛已闭幕");
      const judge = await tx<{ id: string; name: string }[]>`
        SELECT id, name FROM judges WHERE id = ${judgeId} AND event_id = ${eventId}`;
      if (!judge[0]) throw notFound("评委不存在");
      const token = generateToken();
      await tx`UPDATE judges SET invite_token = ${token}, token_hash = ${hashToken(token)} WHERE id = ${judgeId}`;
      await insertAudit(tx, eventId, "judge.rotate_token", { judgeId });
      return {
        value: {
          id: judgeId,
          name: judge[0].name,
          inviteUrl: judgeInviteUrl(inviteBaseUrl, event.slug, token),
        },
        revision: await bumpRevision(tx, eventId),
      };
    },
  );
  await revokeJudgeSessions(sql, judgeId);
  hub.publish(eventId, revision);
  return value;
}

/** 轮换大屏链接并吊销旧大屏会话。 */
export async function rotateDisplayToken(
  sql: Sql,
  inviteBaseUrl: string,
  eventId: string,
): Promise<{ inviteUrl: string }> {
  const { value, revision } = await sql.begin(
    async (tx): Promise<{ value: { inviteUrl: string }; revision: number }> => {
      const event = await lockEvent(tx, eventId);
      if (event.status === "closed") throw new AppError("event_closed", "比赛已闭幕");
      const token = generateToken();
      await tx`
        UPDATE events
           SET display_token = ${token}, display_token_hash = ${hashToken(token)}, updated_at = now()
         WHERE id = ${eventId}`;
      await insertAudit(tx, eventId, "display.rotate_token", {});
      return {
        value: { inviteUrl: `${inviteBaseUrl}/display/${event.slug}#${token}` },
        revision: await bumpRevision(tx, eventId),
      };
    },
  );
  await revokeDisplaySessions(sql, eventId);
  hub.publish(eventId, revision);
  return value;
}

// ---------- CSV 导入 ----------

export async function importProjectsCsv(
  sql: Sql,
  eventId: string,
  csvText: string,
  expectedRevision: number,
): Promise<CsvImportResultDto> {
  if (Buffer.byteLength(csvText, "utf8") > 1024 * 1024) {
    throw new AppError("payload_too_large", "导入文件超过 1MiB");
  }
  const records = mapRows(parseCsv(csvText), [
    ["name", "项目", "项目名称", "名称"],
    ["teamName", "团队", "团队名称"],
    ["summary", "简介", "摘要", "说明"],
  ]);
  const errors: { row: number; message: string }[] = [];
  const valid: { name: string; teamName: string; summary: string }[] = [];
  records.forEach((record, index) => {
    const name = record["name"] ?? "";
    if (!name) {
      errors.push({ row: index + 1, message: "项目名称为空" });
      return;
    }
    if (name.length > 200) {
      errors.push({ row: index + 1, message: "项目名称超过 200 字" });
      return;
    }
    valid.push({
      name,
      teamName: (record["teamName"] ?? "").slice(0, 200),
      summary: (record["summary"] ?? "").slice(0, 2000),
    });
  });

  let created = 0;
  await mutateConfig(sql, eventId, expectedRevision, async (tx) => {
    const countRows = await tx<{ count: number }[]>`
      SELECT count(*)::int AS count FROM projects WHERE event_id = ${eventId}`;
    const room = MAX_PROJECTS - (countRows[0]?.count ?? 0);
    if (valid.length > room) throw new AppError("limit_exceeded", `项目最多 ${MAX_PROJECTS} 个，超出导入量`);
    const maxRows = await tx<{ max: number }[]>`
      SELECT COALESCE(MAX(position), 0)::int AS max FROM projects WHERE event_id = ${eventId}`;
    let position = maxRows[0]?.max ?? 0;
    for (const item of valid) {
      position += 1;
      await tx`
        INSERT INTO projects (id, event_id, name, team_name, summary, position)
        VALUES (${generateId()}, ${eventId}, ${item.name}, ${item.teamName}, ${item.summary}, ${position})`;
      created += 1;
    }
  }, true);
  return { created, errors };
}

export async function importJudgesCsv(
  sql: Sql,
  inviteBaseUrl: string,
  slug: string,
  eventId: string,
  csvText: string,
  expectedRevision: number,
): Promise<CsvImportResultDto> {
  if (Buffer.byteLength(csvText, "utf8") > 1024 * 1024) {
    throw new AppError("payload_too_large", "导入文件超过 1MiB");
  }
  const records = mapRows(parseCsv(csvText), [["name", "姓名", "评委", "评委姓名", "名称"]]);
  const errors: { row: number; message: string }[] = [];
  const valid: string[] = [];
  records.forEach((record, index) => {
    const name = record["name"] ?? "";
    if (!name) errors.push({ row: index + 1, message: "评委姓名为空" });
    else if (name.length > 200) errors.push({ row: index + 1, message: "姓名超过 200 字" });
    else valid.push(name);
  });

  const { value } = await mutateConfig(sql, eventId, expectedRevision, async (tx) => {
    const countRows = await tx<{ count: number }[]>`
      SELECT count(*)::int AS count FROM judges WHERE event_id = ${eventId}`;
    const room = MAX_JUDGES - (countRows[0]?.count ?? 0);
    if (valid.length > room) throw new AppError("limit_exceeded", `评委最多 ${MAX_JUDGES} 名，超出导入量`);
    const invites: JudgeInviteRow[] = [];
    for (const name of valid) invites.push(await insertJudge(tx, eventId, name));
    return invites;
  }, true);
  return {
    created: value.length,
    errors,
    judges: value.map((i) => ({
      id: i.judgeId,
      name: i.name,
      inviteUrl: judgeInviteUrl(inviteBaseUrl, slug, i.token),
    })),
  };
}
