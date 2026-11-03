import {
  computeEventResults,
  judgeTotalMilli,
  type CriterionWeight,
  type EventResults,
} from "@mango-write-judge/domain";

import type { ResultsDto } from "@mango-write-judge/contracts";
import type { Sql, Tx } from "../db/client";

/** 拉取某比赛全部「已提交」评分的最新正式快照（毫位聚合的原始输入）。 */
export async function loadSubmittedTotals(
  tx: Tx,
  eventId: string,
): Promise<Map<string, { submittedCount: number; totalMilliSum: number }>> {
  const criteria = await tx<CriterionWeight[]>`
    SELECT id, weight_percent AS "weightPercent" FROM criteria WHERE event_id = ${eventId}`;
  const rows = await tx<{ project_id: string; items: Record<string, number> }[]>`
    SELECT DISTINCT ON (ev.project_id, ev.judge_id) ev.project_id, r.items
      FROM evaluation_revisions r
      JOIN evaluations ev ON ev.id = r.evaluation_id
     WHERE ev.event_id = ${eventId} AND ev.status = 'submitted'
     ORDER BY ev.project_id, ev.judge_id, r.version DESC`;
  const totals = new Map<string, { submittedCount: number; totalMilliSum: number }>();
  for (const row of rows) {
    const milli = judgeTotalMilli(new Map(Object.entries(row.items)), criteria);
    if (milli === null) continue; // 提交时已校验完整；防御性跳过坏快照
    const current = totals.get(row.project_id) ?? { submittedCount: 0, totalMilliSum: 0 };
    current.submittedCount += 1;
    current.totalMilliSum += milli;
    totals.set(row.project_id, current);
  }
  return totals;
}

export async function computeLiveResults(tx: Tx, eventId: string): Promise<ResultsDto> {
  const judgeRows = await tx<{ judgeCount: number }[]>`
    SELECT count(*)::int AS "judgeCount" FROM judges WHERE event_id = ${eventId}`;
  const judgeCount = judgeRows[0]?.judgeCount ?? 0;
  const projects = await tx<{ id: string; position: number }[]>`
    SELECT id, position FROM projects WHERE event_id = ${eventId} ORDER BY position`;
  const totals = await loadSubmittedTotals(tx, eventId);
  const results: EventResults = computeEventResults(
    judgeCount,
    projects.map((p) => ({
      projectId: p.id,
      position: p.position,
      judgeCount,
      submittedCount: totals.get(p.id)?.submittedCount ?? 0,
      totalMilliSum: totals.get(p.id)?.totalMilliSum ?? null,
    })),
  );
  return {
    algorithmVersion: results.algorithmVersion,
    judgeCount: results.judgeCount,
    rows: results.rows.map((row) => ({
      projectId: row.projectId,
      position: row.position,
      rank: row.rank,
      scoreText: row.scoreText,
      submittedCount: row.submittedCount,
      judgeCount: row.judgeCount,
      complete: row.complete,
    })),
    final: false,
    resultHash: null,
    closedAt: null,
  };
}

/** 最终榜只读 result_snapshots，不重算；未闭幕返回实时结果。 */
export async function getResults(sql: Sql, eventId: string): Promise<ResultsDto> {
  const snapshotRows = await sql<{ snapshot: { results: ResultsDto } }[]>`
    SELECT snapshot FROM result_snapshots WHERE event_id = ${eventId}`;
  const snapshot = snapshotRows[0];
  if (snapshot) return snapshot.snapshot.results;
  return sql.begin("isolation level repeatable read", (tx) => computeLiveResults(tx, eventId));
}
