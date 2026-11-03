import { formatMilli2, judgeTotalMilli, toCsv, UTF8_BOM, type CriterionWeight } from "@mango-write-judge/domain";

import type { Sql } from "../db/client";
import { notFound } from "../http/errors";
import { computeLiveResults } from "./results";
import { insertAudit, readTx, type EventRow } from "./shared";

const tenths = (value: number): string => (value / 10).toFixed(1);

async function loadEvent(sql: Sql, eventId: string): Promise<EventRow> {
  const rows = await sql<EventRow[]>`SELECT * FROM events WHERE id = ${eventId}`;
  if (!rows[0]) throw notFound("比赛不存在");
  return rows[0];
}

export interface CsvExport {
  filename: string;
  body: string;
}

/** 总榜 CSV：闭幕后严格读最终快照，未闭幕导出实时结果并标记 live。 */
export async function exportResultsCsv(sql: Sql, eventId: string): Promise<CsvExport> {
  const event = await loadEvent(sql, eventId);
  const { rows, judgeCount, final } = await (async () => {
    if (event.status !== "closed") {
      const live = await readTx(sql, (tx) => computeLiveResults(tx, eventId));
      return { rows: live.rows, judgeCount: live.judgeCount, final: false };
    }
    const snap = await readTx(sql, async (tx) => {
      const found = await tx<{ snapshot: { results: ReturnType<typeof computeLiveResults> } }[]>`
        SELECT snapshot FROM result_snapshots WHERE event_id = ${eventId}`;
      return found[0]?.snapshot.results ?? null;
    });
    return { rows: snap?.rows ?? [], judgeCount: snap?.judgeCount ?? 0, final: true };
  })();
  const projects = await readTx(sql, (tx) =>
    tx<{ id: string; name: string; team_name: string; position: number }[]>`
      SELECT id, name, team_name, position FROM projects WHERE event_id = ${eventId}`);
  const byId = new Map(projects.map((p) => [p.id, p]));

  const header = [
    "rank",
    "project_order",
    "project_name",
    "team_name",
    "score",
    "submitted_judges",
    "total_judges",
    "is_complete",
    "result_status",
  ];
  const body = rows.map((row) => {
    const project = byId.get(row.projectId);
    return [
      row.rank ?? "",
      project?.position ?? row.position,
      project?.name ?? row.projectId,
      project?.team_name ?? "",
      row.scoreText ?? "",
      row.submittedCount,
      judgeCount,
      row.complete ? "true" : "false",
      final ? "final" : "live",
    ];
  });
  await sql`
    INSERT INTO audit_logs (id, event_id, action, detail)
    VALUES (${crypto.randomUUID()}, ${eventId}, 'export.results', ${JSON.stringify({ final })})`;

  return {
    filename: `${event.slug}-results-${final ? "final" : "live"}.csv`,
    body: UTF8_BOM + toCsv(header, body),
  };
}

/** 评委明细 CSV：只导出正式提交版本；解锁过的项目标记最近改分版本。 */
export async function exportScoresCsv(sql: Sql, eventId: string): Promise<CsvExport> {
  const event = await loadEvent(sql, eventId);
  const data = await readTx(sql, async (tx) => {
    const criteria = await tx<(CriterionWeight & { name: string })[]>`
      SELECT id, name, weight_percent AS "weightPercent" FROM criteria
      WHERE event_id = ${eventId} ORDER BY position`;
    const projects = await tx<{ id: string; name: string; position: number }[]>`
      SELECT id, name, position FROM projects WHERE event_id = ${eventId} ORDER BY position`;
    const judges = await tx<{ id: string; name: string; created_at: Date }[]>`
      SELECT id, name, created_at FROM judges WHERE event_id = ${eventId} ORDER BY created_at, id`;
    const revisions = await tx<
      { project_id: string; judge_id: string; items: Record<string, number>; version: number; submitted_at: Date }[]
    >`
      SELECT DISTINCT ON (ev.project_id, ev.judge_id)
             ev.project_id, ev.judge_id, r.items, r.version, r.submitted_at
        FROM evaluation_revisions r
        JOIN evaluations ev ON ev.id = r.evaluation_id
       WHERE ev.event_id = ${eventId} AND ev.status = 'submitted'
       ORDER BY ev.project_id, ev.judge_id, r.version DESC`;
    return { criteria, projects, judges, revisions };
  });

  const header = [
    "project_order",
    "project_name",
    "judge_name",
    "status",
    "total_score",
    ...data.criteria.map((c) => `${c.name}(${c.weightPercent}%)`),
    "submitted_at",
    "revision",
  ];
  const revisionKey = (projectId: string, judgeId: string) => `${projectId}:${judgeId}`;
  const byKey = new Map(data.revisions.map((r) => [revisionKey(r.project_id, r.judge_id), r]));

  const rows: (string | number)[][] = [];
  for (const project of data.projects) {
    for (const judge of data.judges) {
      const revision = byKey.get(revisionKey(project.id, judge.id));
      if (!revision) {
        rows.push([project.position, project.name, judge.name, "missing", "", ...data.criteria.map(() => ""), "", ""]);
        continue;
      }
      const milli = judgeTotalMilli(new Map(Object.entries(revision.items)), data.criteria);
      rows.push([
        project.position,
        project.name,
        judge.name,
        "submitted",
        milli === null ? "" : formatMilli2(milli),
        ...data.criteria.map((c) => {
          const value = revision.items[c.id];
          return value === undefined ? "" : tenths(value);
        }),
        revision.submitted_at.toISOString(),
        revision.version,
      ]);
    }
  }

  await sql`
    INSERT INTO audit_logs (id, event_id, action, detail)
    VALUES (${crypto.randomUUID()}, ${eventId}, 'export.scores', ${JSON.stringify({ final: event.status === "closed" })})`;

  return {
    filename: `${event.slug}-scores-${event.status === "closed" ? "final" : "live"}.csv`,
    body: UTF8_BOM + toCsv(header, rows),
  };
}
