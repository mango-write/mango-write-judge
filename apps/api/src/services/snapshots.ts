import {
  checkCanStart,
  evaluationPermission,
  judgeTotalMilli,
  formatMilli2,
  type CriterionWeight,
} from "@mango-write-judge/domain";
import type {
  AdminSnapshotDto,
  DisplaySnapshotDto,
  JudgeSnapshotDto,
  MatrixCellDto,
  MatrixRowDto,
} from "@mango-write-judge/contracts";

import type { Sql, Tx } from "../db/client";
import { notFound } from "../http/errors";
import { displayInviteUrl, judgeInviteUrl } from "./config";
import { computeLiveResults } from "./results";
import { readTx, type EventRow } from "./shared";

async function loadEventForRead(tx: Tx, eventId: string): Promise<EventRow> {
  const rows = await tx<EventRow[]>`SELECT * FROM events WHERE id = ${eventId}`;
  if (!rows[0]) throw notFound("比赛不存在");
  return rows[0];
}

async function loadSnapshotResults(tx: Tx, event: EventRow) {
  if (event.status !== "closed") return { results: await computeLiveResults(tx, event.id), resultHash: null as string | null };
  const rows = await tx<{ result_hash: string; snapshot: { results: AdminSnapshotDto["results"] } }[]>`
    SELECT result_hash, snapshot FROM result_snapshots WHERE event_id = ${event.id}`;
  return { results: rows[0]?.snapshot.results ?? null, resultHash: rows[0]?.result_hash ?? null };
}

/** 管理端完整现场快照：配置 + 提交矩阵 + 结果（闭幕后读快照）。 */
export async function getAdminSnapshot(sql: Sql, eventId: string, inviteBaseUrl = ""): Promise<AdminSnapshotDto> {
  return readTx(sql, async (tx) => {
    const event = await loadEventForRead(tx, eventId);
    const criteria = await tx<(CriterionWeight & { name: string; description: string; position: number })[]>`
      SELECT id, name, description, weight_percent AS "weightPercent", position
      FROM criteria WHERE event_id = ${eventId} ORDER BY position`;
    const projects = await tx<
      { id: string; name: string; team_name: string; summary: string; position: number; unlocked_at: Date | null }[]
    >`
      SELECT id, name, team_name, summary, position, unlocked_at FROM projects
      WHERE event_id = ${eventId} ORDER BY position`;
    const judges = await tx<{ id: string; name: string; invite_token: string; created_at: Date }[]>`
      SELECT id, name, invite_token, created_at FROM judges WHERE event_id = ${eventId} ORDER BY created_at, id`;
    const evaluations = await tx<
      { id: string; judge_id: string; project_id: string; status: "draft" | "submitted"; version: number; submitted_at: Date | null }[]
    >`
      SELECT id, judge_id, project_id, status, version, submitted_at FROM evaluations
      WHERE event_id = ${eventId}`;
    const revisions = await tx<{ evaluation_id: string; items: Record<string, number> }[]>`
      SELECT DISTINCT ON (r.evaluation_id) r.evaluation_id, r.items
        FROM evaluation_revisions r
        JOIN evaluations ev ON ev.id = r.evaluation_id
       WHERE ev.event_id = ${eventId}
       ORDER BY r.evaluation_id, r.version DESC`;
    const revisionItems = new Map(revisions.map((r) => [r.evaluation_id, r.items]));
    const unlocks = await tx<{ evaluation_id: string }[]>`
      SELECT DISTINCT evaluation_id FROM evaluation_unlocks u
      WHERE u.revoked_at IS NULL AND u.used_at IS NULL
        AND u.evaluation_id IN (SELECT id FROM evaluations WHERE event_id = ${eventId})`;
    const unlockedIds = new Set(unlocks.map((u) => u.evaluation_id));
    const criteriaWeights: CriterionWeight[] = criteria.map((c) => ({ id: c.id, weightPercent: c.weightPercent }));

    const byProject = new Map(projects.map((p) => [p.id, p]));
    const matrix: MatrixRowDto[] = [];
    for (const project of projects) {
      const cells: MatrixCellDto[] = judges.map((judge) => {
        const evaluation = evaluations.find((e) => e.judge_id === judge.id && e.project_id === project.id);
        if (!evaluation) {
          return {
            judgeId: judge.id,
            evaluationId: null,
            status: "none",
            version: 0,
            submittedAt: null,
            unlocked: false,
            submittedItems: null,
            submittedTotalText: null,
          };
        }
        const items = revisionItems.get(evaluation.id) ?? null;
        const total =
          items && evaluation.status === "submitted"
            ? judgeTotalMilli(new Map(Object.entries(items)), criteriaWeights)
            : null;
        return {
          judgeId: judge.id,
          evaluationId: evaluation.id,
          status: evaluation.status,
          version: evaluation.version,
          submittedAt: evaluation.submitted_at ? evaluation.submitted_at.toISOString() : null,
          unlocked: unlockedIds.has(evaluation.id),
          submittedItems: items,
          submittedTotalText: total === null ? null : formatMilli2(total),
        };
      });
      matrix.push({ projectId: project.id, cells });
    }

    const { results, resultHash } = await loadSnapshotResults(tx, event);
    const weights = criteria.map((c) => c.weightPercent);
    const weightsSum = weights.reduce((a, b) => a + b, 0);
    const check = checkCanStart({
      criteriaCount: criteria.length,
      projectsCount: projects.length,
      judgesCount: judges.length,
      weights,
    });
    return {
      event: {
        id: event.id,
        slug: event.slug,
        name: event.name,
        description: event.description,
        status: event.status,
        revision: event.revision,
        displayMode: event.display_mode,
        displayInviteUrl: event.display_token ? displayInviteUrl(inviteBaseUrl, event.slug, event.display_token) : "",
        revealedAt: event.revealed_at ? event.revealed_at.toISOString() : null,
        closedAt: event.closed_at ? event.closed_at.toISOString() : null,
        activeProjectId: event.active_project_id,
        criteria: criteria.map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          weightPercent: c.weightPercent,
          position: c.position,
        })),
        projects: projects.map((p) => ({
          id: p.id,
          name: p.name,
          teamName: p.team_name,
          summary: p.summary,
          position: p.position,
          unlockedAt: p.unlocked_at ? p.unlocked_at.toISOString() : null,
          active: event.active_project_id === p.id,
        })),
        judges: judges.map((j) => ({
          id: j.id,
          name: j.name,
          inviteUrl: j.invite_token ? judgeInviteUrl(inviteBaseUrl, event.slug, j.invite_token) : "",
          createdAt: j.created_at.toISOString(),
        })),
        weightsSum,
        startCheck: {
          ok: check.ok,
          code: check.ok ? null : (check as { code: string }).code,
          criterionCount: criteria.length,
          projectCount: projects.length,
          judgeCount: judges.length,
          weightsSum,
          displayLinkReady: true,
        },
        createdAt: event.created_at.toISOString(),
        updatedAt: event.updated_at.toISOString(),
      },
      matrix,
      results,
      revision: event.revision,
    };
  });
}

/** 评委快照：自己的评分与权限；绝不包含其他评委的评分。 */
export async function getJudgeSnapshot(sql: Sql, eventId: string, judgeId: string): Promise<JudgeSnapshotDto> {
  return readTx(sql, async (tx) => {
    const event = await loadEventForRead(tx, eventId);
    const judgeRows = await tx<{ id: string; name: string }[]>`
      SELECT id, name FROM judges WHERE id = ${judgeId} AND event_id = ${eventId}`;
    const judge = judgeRows[0];
    if (!judge) throw notFound("评委不存在");
    const criteria = await tx<(CriterionWeight & { name: string; description: string; position: number })[]>`
      SELECT id, name, description, weight_percent AS "weightPercent", position
      FROM criteria WHERE event_id = ${eventId} ORDER BY position`;
    const projects = await tx<
      { id: string; name: string; team_name: string; summary: string; position: number; unlocked_at: Date | null }[]
    >`
      SELECT id, name, team_name, summary, position, unlocked_at FROM projects
      WHERE event_id = ${eventId} ORDER BY position`;
    const evaluations = await tx<
      { id: string; project_id: string; status: "draft" | "submitted"; version: number; submitted_at: Date | null }[]
    >`
      SELECT id, project_id, status, version, submitted_at FROM evaluations
      WHERE event_id = ${eventId} AND judge_id = ${judgeId}`;
    const items = await tx<{ evaluation_id: string; criterion_id: string; score_tenths: number }[]>`
      SELECT i.evaluation_id, i.criterion_id, i.score_tenths FROM evaluation_items i
      JOIN evaluations e ON e.id = i.evaluation_id
      WHERE e.event_id = ${eventId} AND e.judge_id = ${judgeId}`;
    const itemsByEvaluation = new Map<string, Record<string, number>>();
    for (const row of items) {
      const record = itemsByEvaluation.get(row.evaluation_id) ?? {};
      record[row.criterion_id] = row.score_tenths;
      itemsByEvaluation.set(row.evaluation_id, record);
    }
    const revisions = await tx<{ evaluation_id: string; items: Record<string, number> }[]>`
      SELECT DISTINCT ON (r.evaluation_id) r.evaluation_id, r.items
        FROM evaluation_revisions r
        JOIN evaluations ev ON ev.id = r.evaluation_id
       WHERE ev.event_id = ${eventId} AND ev.judge_id = ${judgeId}
       ORDER BY r.evaluation_id, r.version DESC`;
    const revisionItems = new Map(revisions.map((r) => [r.evaluation_id, r.items]));
    const unlocks = await tx<{ evaluation_id: string }[]>`
      SELECT DISTINCT evaluation_id FROM evaluation_unlocks u
      WHERE u.revoked_at IS NULL AND u.used_at IS NULL
        AND u.evaluation_id IN (
          SELECT id FROM evaluations WHERE event_id = ${eventId} AND judge_id = ${judgeId})`;
    const unlockedIds = new Set(unlocks.map((u) => u.evaluation_id));

    return {
      event: { name: event.name, slug: event.slug, status: event.status },
      judge: { id: judge.id, name: judge.name },
      criteria: criteria.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        weightPercent: c.weightPercent,
        position: c.position,
      })),
      projects: projects.map((project) => {
        const evaluation = evaluations.find((e) => e.project_id === project.id);
        if (!evaluation) {
          return {
            id: project.id,
            name: project.name,
            teamName: project.team_name,
            summary: project.summary,
            position: project.position,
            unlocked: project.unlocked_at != null,
            active: event.active_project_id === project.id,
            evaluation: null,
          };
        }
        const permission = evaluationPermission({
          eventStatus: event.status,
          projectUnlocked: project.unlocked_at != null,
          revealed: event.revealed_at != null,
          submittedVersion: evaluation.version,
          hasValidUnlock: unlockedIds.has(evaluation.id),
        });
        const submittedItems = revisionItems.get(evaluation.id) ?? null;
        const total =
          submittedItems && evaluation.status === "submitted"
            ? judgeTotalMilli(new Map(Object.entries(submittedItems)), criteria)
            : null;
        return {
          id: project.id,
          name: project.name,
          teamName: project.team_name,
          summary: project.summary,
          position: project.position,
          unlocked: project.unlocked_at != null,
          active: event.active_project_id === project.id,
          evaluation: {
            status: evaluation.status,
            version: evaluation.version,
            canSaveDraft: permission.canSaveDraft,
            canSubmit: permission.canSubmit,
            lockedByReveal: permission.lockedByReveal,
            items: itemsByEvaluation.get(evaluation.id) ?? {},
            submittedAt: evaluation.submitted_at ? evaluation.submitted_at.toISOString() : null,
            submittedTotalText: total === null ? null : formatMilli2(total),
          },
        };
      }),
      revision: event.revision,
    };
  });
}

/**
 * 大屏快照：progress 投影不含任何成绩/均分/排名字段（查询本身就不碰评分），
 * ranking 投影含实时或最终榜单。
 */
export async function getDisplaySnapshot(sql: Sql, eventId: string): Promise<DisplaySnapshotDto> {
  return readTx(sql, async (tx) => {
    const event = await loadEventForRead(tx, eventId);
    if (event.display_mode === "progress") {
      const judgeRows = await tx<{ count: number }[]>`
        SELECT count(*)::int AS count FROM judges WHERE event_id = ${eventId}`;
      if (!event.active_project_id) {
        return {
          revision: event.revision,
          mode: "progress",
          eventName: event.name,
          status: event.status,
          currentProject: null,
          submittedCount: 0,
          judgeCount: judgeRows[0]?.count ?? 0,
        };
      }
      const project = await tx<{ position: number; name: string; team_name: string; summary: string }[]>`
        SELECT position, name, team_name, summary FROM projects
        WHERE id = ${event.active_project_id} AND event_id = ${eventId}`;
      const submitted = await tx<{ count: number }[]>`
        SELECT count(*)::int AS count FROM evaluations
        WHERE event_id = ${eventId} AND project_id = ${event.active_project_id} AND status = 'submitted'`;
      return {
        revision: event.revision,
        mode: "progress",
        eventName: event.name,
        status: event.status,
        currentProject: project[0]
          ? {
              position: project[0].position,
              name: project[0].name,
              teamName: project[0].team_name,
              ...(project[0].summary ? { summary: project[0].summary } : {}),
            }
          : null,
        submittedCount: submitted[0]?.count ?? 0,
        judgeCount: judgeRows[0]?.count ?? 0,
      };
    }

    const { results, resultHash } = await loadSnapshotResults(tx, event);
    const names = await tx<{ id: string; name: string; team_name: string }[]>`
      SELECT id, name, team_name FROM projects WHERE event_id = ${eventId}`;
    const nameById = new Map(names.map((p) => [p.id, p]));
    return {
      revision: event.revision,
      mode: "ranking",
      eventName: event.name,
      status: event.status,
      final: event.status === "closed",
      resultHash,
      judgeCount: results?.judgeCount ?? 0,
      rows: (results?.rows ?? []).map((row) => ({
        projectId: row.projectId,
        position: row.position,
        rank: row.rank,
        scoreText: row.scoreText,
        submittedCount: row.submittedCount,
        judgeCount: row.judgeCount,
        complete: row.complete,
        name: nameById.get(row.projectId)?.name ?? row.projectId,
        teamName: nameById.get(row.projectId)?.team_name ?? "",
      })),
    };
  });
}
