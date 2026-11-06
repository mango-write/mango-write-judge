import type { Context, MiddlewareHandler } from "hono";
import type { ZodType } from "zod";

import { getSessionToken, lookupSession, type SessionRow } from "../auth/session";
import type { Sql } from "../db/client";
import { AppError, forbidden, unauthorized } from "../http/errors";
import type { AdminUserRow } from "../services/accounts";

export interface RouteDeps {
  sql: import("../db/client").Sql;
  config: import("../config").AppConfig;
}

/** 全应用共享 Env：父应用与子路由的 Variables 必须一致才能 app.route 挂载。 */
export type AppEnv = {
  Variables: {
    judgeSession: SessionRow;
    displaySession: SessionRow;
    adminUser: AdminUserRow;
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

export function adminGuard(sql: Sql): MiddlewareHandler {
  return async (c, next) => {
    const session = await requireRole(c, sql, "admin");
    // 迁移前遗留的 admin 会话没有归属账号，直接按失效处理
    if (!session.admin_user_id) throw unauthorized();
    const rows = await sql<AdminUserRow[]>`
      SELECT id, username, name, role, password_hash, disabled, created_at
        FROM admin_users WHERE id = ${session.admin_user_id} LIMIT 1
    `;
    const user = rows[0];
    if (!user || user.disabled) throw unauthorized();
    c.set("adminUser", user);
    await next();
  };
}

/** 账户管理面：仅超管。挂在 adminGuard 之后使用。 */
export function superGuard(): MiddlewareHandler {
  return async (c, next) => {
    if (c.get("adminUser").role !== "super") throw forbidden("仅超级管理员可管理账户");
    await next();
  };
}

export function clientIp(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return (c.env as { remote?: { address?: string } } | undefined)?.remote?.address ?? "unknown";
}
