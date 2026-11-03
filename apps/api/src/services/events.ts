import { createHash, randomBytes } from "node:crypto";

import {
  checkCanStart,
  type CriterionWeight,
  type StartIssueCode,
} from "@mango-write-judge/domain";
import type {
  CriterionDto,
  EventDetailDto,
  EventSummaryDto,
  JudgeDto,
  ProjectDto,
  ResultsDto,
  StartCheckDto,
} from "@mango-write-judge/contracts";

import { generateId, generateToken, hashToken } from "../auth/tokens";
import type { Sql } from "../db/client";
import { AppError, notFound } from "../http/errors";
import { hub } from "../realtime/hub";
import { computeLiveResults } from "./results";
import { bumpRevision, insertAudit, iso, lockEvent, readTx, stableStringify, type EventRow } from "./shared";

export async function listEvents(sql: Sql): Promise<EventSummaryDto[]> {
  const rows = await sql<
    (EventRow & { criterion_count: number; project_count: number; judge_count: number })[]
  >`
    SELECT e.*,
           (SELECT count(*)::int FROM criteria c WHERE c.event_id = e.id) AS criterion_count,
           (SELECT count(*)::int FROM projects p WHERE p.event_id = e.id) AS project_count,
           (SELECT count(*)::int FROM judges j WHERE j.event_id = e.id) AS judge_count
      FROM events e ORDER BY e.updated_at DESC`;
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    criterionCount: row.criterion_count,
    projectCount: row.project_count,
    judgeCount: row.judge_count,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }));
}

function toStartCheck(
  weights: number[],
  counts: { criterionCount: number; projectCount: number; judgeCount: number },
): StartCheckDto {
  const check = checkCanStart({
    criteriaCount: counts.criterionCount,
    projectsCount: counts.projectCount,
    judgesCount: counts.judgeCount,
    weights,
  });
  return {
    ok: check.ok,
    code: check.ok ? null : (check as { code: StartIssueCode }).code,
    ...counts,
    weightsSum: weights.reduce((a, b) => a + b, 0),
    displayLinkReady: true,
  };
}

export async function getEventDetail(sql: Sql, eventId: string): Promise<EventDetailDto> {
  return readTx(sql, async (tx) => {
    const rows = await tx<EventRow[]>`SELECT * FROM events WHERE id = ${eventId}`;
    const event = rows[0];
    if (!event) throw notFound("比赛不存在");
    const criteria = await tx<(CriterionDto & { weight_percent: number })[]>`
      SELECT id, name, description, weight_percent, position FROM criteria
      WHERE event_id = ${eventId} ORDER BY position`;
    const projects = await tx<
      (ProjectDto & { unlocked_at: Date | null; active_project_id: string | null })[]
    >`
      SELECT p.id, p.name, p.team_name AS "teamName", p.summary, p.position,
             p.unlocked_at, e.active_project_id
        FROM projects p CROSS JOIN events e
       WHERE p.event_id = ${eventId} AND e.id = ${eventId}
       ORDER BY p.position`;
    const judges = await tx<(JudgeDto & { created_at: Date })[]>`
      SELECT id, name, created_at FROM judges WHERE event_id = ${eventId} ORDER BY created_at, id`;
    const criteriaDtos: CriterionDto[] = criteria.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      weightPercent: c.weight_percent,
      position: c.position,
    }));
    const projectDtos: ProjectDto[] = projects.map((p) => ({
      id: p.id,
      name: p.name,
      teamName: p.teamName,
      summary: p.summary,
      position: p.position,
      unlockedAt: p.unlocked_at ? p.unlocked_at.toISOString() : null,
      active: p.active_project_id === p.id,
    }));
    const judgeDtos: JudgeDto[] = judges.map((j) => ({
      id: j.id,
      name: j.name,
      createdAt: j.created_at.toISOString(),
    }));
    const weights = criteriaDtos.map((c) => c.weightPercent);
    return {
      id: event.id,
      slug: event.slug,
      name: event.name,
      description: event.description,
      status: event.status,
      revision: event.revision,
      displayMode: event.display_mode,
      revealedAt: iso(event.revealed_at),
      closedAt: iso(event.closed_at),
      activeProjectId: event.active_project_id,
      criteria: criteriaDtos,
      projects: projectDtos,
      judges: judgeDtos,
      weightsSum: weights.reduce((a, b) => a + b, 0),
      startCheck: toStartCheck(weights, {
        criterionCount: criteriaDtos.length,
        projectCount: projectDtos.length,
        judgeCount: judgeDtos.length,
      }),
      createdAt: event.created_at.toISOString(),
      updatedAt: event.updated_at.toISOString(),
    };
  });
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "event";
}

export async function createEvent(
  sql: Sql,
  input: { name: string; slug?: string; description: string },
): Promise<EventDetailDto> {
  const id = generateId();
  let slug = input.slug ?? slugify(input.name);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await sql`
        INSERT INTO events (id, slug, name, description, display_token_hash)
        VALUES (${id}, ${slug}, ${input.name}, ${input.description}, ${hashToken(generateToken())})`;
      return getEventDetail(sql, id);
    } catch (error) {
      const message = String(error);
      if (!message.includes("events_slug_key")) throw error;
      if (input.slug) throw new AppError("slug_taken", "该 URL slug 已被使用");
      slug = `${slugify(input.name)}-${randomBytes(2).toString("hex")}`;
    }
  }
  throw new AppError("slug_taken", "无法生成可用 slug，请手动指定");
}

export async function patchEvent(
  sql: Sql,
  eventId: string,
  input: { name?: string; description?: string; expectedRevision: number },
): Promise<EventDetailDto> {
  await sql.begin(async (tx) => {
    const event = await lockEvent(tx, eventId);
    if (event.revision !== input.expectedRevision) {
      throw new AppError("revision_conflict", "比赛配置已被其他操作修改，请刷新后重试");
    }
    await tx`
      UPDATE events SET name = COALESCE(${input.name ?? null}, name),
                        description = COALESCE(${input.description ?? null}, description),
                        updated_at = now()
      WHERE id = ${eventId}`;
  });
  return getEventDetail(sql, eventId);
}

const startErrorOf = (code: StartIssueCode): AppError =>
  code === "no_projects" || code === "no_judges"
    ? new AppError("validation_error", `无法启动：${code === "no_projects" ? "至少需要一个项目" : "至少需要一名评委"}`, { code })
    : new AppError("invalid_weights", "评分项权重不合法（1–100 整数、合计 100%）", { code });

export async function startEvent(sql: Sql, eventId: string): Promise<{ revision: number }> {
  let revision = 0;
  await sql.begin(async (tx) => {
    const event = await lockEvent(tx, eventId);
    if (event.status === "closed") throw new AppError("event_closed", "比赛已闭幕");
    if (event.status === "judging") throw new AppError("event_not_draft", "比赛已启动");
    const criteria = await tx<CriterionWeight[]>`
      SELECT id, weight_percent AS "weightPercent" FROM criteria WHERE event_id = ${eventId}`;
    const counts = await tx<{ projects: number; judges: number }[]>`
      SELECT (SELECT count(*)::int FROM projects WHERE event_id = ${eventId}) AS projects,
             (SELECT count(*)::int FROM judges WHERE event_id = ${eventId}) AS judges`;
    const check = checkCanStart({
      criteriaCount: criteria.length,
      projectsCount: counts[0]?.projects ?? 0,
      judgesCount: counts[0]?.judges ?? 0,
      weights: criteria.map((c) => c.weightPercent),
    });
    if (!check.ok) throw startErrorOf(check.code);
    await tx`UPDATE events SET status = 'judging', updated_at = now() WHERE id = ${eventId}`;
    await insertAudit(tx, eventId, "event.start", {});
    revision = await bumpRevision(tx, eventId);
  });
  hub.publish(eventId, revision);
  return { revision };
}

export async function setActiveProject(
  sql: Sql,
  eventId: string,
  projectId: string,
): Promise<{ revision: number }> {
  let revision = 0;
  await sql.begin(async (tx) => {
    const event = await lockEvent(tx, eventId);
    if (event.status !== "judging") {
      throw new AppError(event.status === "closed" ? "event_closed" : "event_not_draft", "比赛未在评审阶段");
    }
    const project = await tx<{ id: string; name: string }[]>`
      SELECT id, name FROM projects WHERE id = ${projectId} AND event_id = ${eventId}`;
    if (!project[0]) throw notFound("项目不存在");
    await tx`
      UPDATE projects SET unlocked_at = COALESCE(unlocked_at, now()) WHERE id = ${projectId}`;
    await tx`UPDATE events SET active_project_id = ${projectId}, updated_at = now() WHERE id = ${eventId}`;
    await insertAudit(tx, eventId, "project.activate", { projectId });
    revision = await bumpRevision(tx, eventId);
  });
  hub.publish(eventId, revision);
  return { revision };
}

export interface DisplayModeResult {
  displayMode: "progress" | "ranking";
  revealedAt: string | null;
  revision: number;
}

export async function setDisplayMode(
  sql: Sql,
  eventId: string,
  mode: "progress" | "ranking",
  confirmReveal: boolean,
): Promise<DisplayModeResult> {
  const result = await sql.begin(async (tx): Promise<DisplayModeResult> => {
    const event = await lockEvent(tx, eventId);
    if (mode === "ranking" && event.status === "draft") {
      throw new AppError("event_not_draft", "比赛启动后才能公开排行");
    }
    const firstReveal = mode === "ranking" && event.revealed_at === null;
    if (firstReveal && !confirmReveal) {
      throw new AppError(
        "reveal_confirm_required",
        "首次公开排行后，修改旧评分需要管理员解锁；切回进度模式不会恢复自由改分",
      );
    }
    await tx`UPDATE events SET display_mode = ${mode}, updated_at = now() WHERE id = ${eventId}`;
    if (firstReveal) {
      await tx`UPDATE events SET revealed_at = now() WHERE id = ${eventId}`;
      await insertAudit(tx, eventId, "ranking.reveal", {});
    }
    if (event.display_mode !== mode || firstReveal) {
      await insertAudit(tx, eventId, "display.switch", { mode });
    }
    return {
      displayMode: mode,
      revealedAt: iso(firstReveal ? new Date() : event.revealed_at),
      revision: await bumpRevision(tx, eventId),
    };
  });
  hub.publish(eventId, result.revision);
  return result;
}

export interface CloseResult {
  revision: number;
  resultHash: string;
  missing: { projectId: string; name: string; missingJudges: number }[];
}

export async function closeEvent(sql: Sql, eventId: string): Promise<CloseResult> {
  const outcome = await sql.begin(async (tx): Promise<CloseResult> => {
    const event = await lockEvent(tx, eventId);
    if (event.status === "closed") throw new AppError("event_closed", "比赛已闭幕");
    if (event.status === "draft") throw new AppError("event_not_draft", "比赛尚未启动");

    const results = await computeLiveResults(tx, eventId);
    const projects = await tx<{ id: string; name: string; position: number }[]>`
      SELECT id, name, position FROM projects WHERE event_id = ${eventId} ORDER BY position`;
    const criteria = await tx<CriterionWeight[]>`
      SELECT id, weight_percent AS "weightPercent" FROM criteria WHERE event_id = ${eventId}`;
    const byProject = new Map(results.rows.map((r) => [r.projectId, r]));
    const missing = projects
      .map((p) => ({
        projectId: p.id,
        name: p.name,
        missingJudges: results.judgeCount - (byProject.get(p.id)?.submittedCount ?? 0),
      }))
      .filter((m) => m.missingJudges > 0);

    const snapshot = {
      algorithmVersion: results.algorithmVersion,
      judgeCount: results.judgeCount,
      criteria,
      results,
      missing,
    };
    const resultHash = createHash("sha256").update(stableStringify(snapshot)).digest("hex");
    await tx`
      INSERT INTO result_snapshots (event_id, algorithm_version, result_hash, snapshot)
      VALUES (${eventId}, ${results.algorithmVersion}, ${resultHash}, ${tx.json(snapshot as never)})
      ON CONFLICT (event_id) DO NOTHING`;
    await tx`
      UPDATE events SET status = 'closed', closed_at = now(), updated_at = now() WHERE id = ${eventId}`;
    await insertAudit(tx, eventId, "event.close", { resultHash, missingCount: missing.length });
    return { revision: await bumpRevision(tx, eventId), resultHash, missing };
  });
  hub.publish(eventId, outcome.revision);
  return outcome;
}
