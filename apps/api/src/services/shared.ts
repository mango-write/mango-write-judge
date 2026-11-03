import { generateId } from "../auth/tokens";
import type { Sql, Tx } from "../db/client";
import { AppError, notFound } from "../http/errors";

export interface EventRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: "draft" | "judging" | "closed";
  active_project_id: string | null;
  display_mode: "progress" | "ranking";
  revealed_at: Date | null;
  revision: number;
  display_token_hash: string;
  closed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** 写事务入口：先锁 event 行再判定状态，与 reveal/close/提交互斥。 */
export async function lockEvent(tx: Tx, eventId: string): Promise<EventRow> {
  const rows = await tx<EventRow[]>`SELECT * FROM events WHERE id = ${eventId} FOR UPDATE`;
  const row = rows[0];
  if (!row) throw notFound("比赛不存在");
  return row;
}

export async function getEvent(sql: Sql, eventId: string): Promise<EventRow> {
  const rows = await sql<EventRow[]>`SELECT * FROM events WHERE id = ${eventId}`;
  const row = rows[0];
  if (!row) throw notFound("比赛不存在");
  return row;
}

/** revision 只与业务写在同一事务递增；返回新值供事务提交后 publish。 */
export async function bumpRevision(tx: Tx, eventId: string): Promise<number> {
  const rows = await tx<{ revision: number }[]>`
    UPDATE events SET revision = revision + 1, updated_at = now()
    WHERE id = ${eventId} RETURNING revision`;
  return rows[0]!.revision;
}

export async function insertAudit(
  tx: Tx,
  eventId: string,
  action: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await tx`
    INSERT INTO audit_logs (id, event_id, action, detail)
    VALUES (${generateId()}, ${eventId}, ${action}, ${tx.json(detail as never)})`;
}

/** 快照读取：repeatable read 单一快照，避免拼出跨版本状态。 */
export function readTx<T>(sql: Sql, fn: (tx: Tx) => Promise<T>): Promise<T> {
  // postgres.js 直接拼 `begin <options>`，需写全 isolation level 子句
  return sql.begin("isolation level repeatable read", fn) as Promise<T>;
}

/** 状态守卫：closed 优先报 event_closed；其余非目标状态按语义报错。 */
export function requireStatus(event: EventRow, expected: EventRow["status"], code: "event_closed" | "event_not_draft", message: string): void {
  if (event.status === expected) return;
  if (event.status === "closed") {
    throw new AppError("event_closed", "比赛已闭幕，全部锁定");
  }
  throw new AppError(code, message);
}

/** 稳定序列化（键排序），用于结果快照哈希。 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

export const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
