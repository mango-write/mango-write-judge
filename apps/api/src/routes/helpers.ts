import { createHash, timingSafeEqual } from "node:crypto";

import type { Context, MiddlewareHandler } from "hono";
import type { ZodType } from "zod";

import { getSessionToken, lookupSession, type SessionRow } from "../auth/session";
import { AppError, unauthorized } from "../http/errors";

export interface RouteDeps {
  sql: import("../db/client").Sql;
  config: import("../config").AppConfig;
}

/** 全应用共享 Env：父应用与子路由的 Variables 必须一致才能 app.route 挂载。 */
export type AppEnv = {
  Variables: {
    judgeSession: SessionRow;
    displaySession: SessionRow;
  };
};

export async function readJson<T>(c: Context, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new AppError("validation_error", "请求体不是合法 JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError("validation_error", parsed.error.issues[0]?.message ?? "请求参数不合法", {
      issues: parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path, message: i.message })),
    });
  }
  return parsed.data;
}

/** 会话从 cookie 恢复；角色不对按未授权处理。 */
export async function requireRole(
  c: Context,
  sql: import("../db/client").Sql,
  role: SessionRow["role"],
): Promise<SessionRow> {
  const session = await lookupSession(sql, getSessionToken(c, role));
  if (!session || session.role !== role) throw unauthorized();
  return session;
}

export function adminGuard(sql: import("../db/client").Sql): MiddlewareHandler {
  return async (c, next) => {
    await requireRole(c, sql, "admin");
    await next();
  };
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function clientIp(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return (c.env as { remote?: { address?: string } } | undefined)?.remote?.address ?? "unknown";
}
