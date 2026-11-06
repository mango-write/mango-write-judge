// 管理端账户：超管首次启动从 ADMIN_PASSWORD 播种（此后改 env 不影响已建账号），
// 账号管理仅超管可用（routes 层 superGuard）。这里只管账号本身，赛事权限不区分。
import { randomBytes } from "node:crypto";

import type { AdminAccountDto, AdminRole } from "@mango-write-judge/contracts";

import { hashPassword, verifyPassword } from "../auth/password";
import { revokeAdminUserSessions } from "../auth/session";
import { generateId } from "../auth/tokens";
import type { Sql, Tx } from "../db/client";
import { AppError, forbidden, notFound, unauthorized } from "../http/errors";

export interface AdminUserRow {
  id: string;
  username: string;
  name: string;
  role: AdminRole;
  password_hash: string;
  disabled: boolean;
  created_at: Date;
}

function toAccountDto(row: AdminUserRow): AdminAccountDto {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    role: row.role,
    disabled: row.disabled,
    createdAt: row.created_at.toISOString(),
  };
}

/** 首次播种：库中没有任何超管时用 ADMIN_PASSWORD 建用户名 admin 的超管，仅此一次。 */
export async function ensureSuperAdmin(sql: Sql, bootstrapPassword: string): Promise<void> {
  const existing = await sql`SELECT id FROM admin_users WHERE role = 'super' LIMIT 1`;
  if (existing.length) return;
  await sql`
    INSERT INTO admin_users (id, username, name, role, password_hash)
    VALUES (${generateId()}, 'admin', '超级管理员', 'super', ${await hashPassword(bootstrapPassword)})
  `;
}

export async function listAdminUsers(sql: Sql): Promise<AdminAccountDto[]> {
  const rows = await sql<AdminUserRow[]>`
    SELECT id, username, name, role, password_hash, disabled, created_at
      FROM admin_users ORDER BY created_at ASC
  `;
  return rows.map(toAccountDto);
}

export async function getAdminUser(sql: Sql | Tx, id: string): Promise<AdminUserRow | null> {
  const rows = await sql<AdminUserRow[]>`
    SELECT id, username, name, role, password_hash, disabled, created_at
      FROM admin_users WHERE id = ${id} LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function findAdminUserByUsername(sql: Sql, username: string): Promise<AdminUserRow | null> {
  const rows = await sql<AdminUserRow[]>`
    SELECT id, username, name, role, password_hash, disabled, created_at
      FROM admin_users WHERE username = ${username} LIMIT 1
  `;
  return rows[0] ?? null;
}

// 用户不存在/停用时也对 dummy hash 走一次 scrypt，抹平登录耗时差，防用户名枚举。
let dummyHash: string | null = null;
async function burnDummyVerify(password: string): Promise<void> {
  dummyHash ??= await hashPassword(randomBytes(16).toString("hex"));
  await verifyPassword(password, dummyHash);
}

export async function authenticateAdminUser(
  sql: Sql,
  username: string,
  password: string,
): Promise<AdminUserRow> {
  const user = await findAdminUserByUsername(sql, username);
  if (!user || user.disabled) {
    await burnDummyVerify(password);
    throw unauthorized("用户名或密码错误");
  }
  if (!(await verifyPassword(password, user.password_hash))) throw unauthorized("用户名或密码错误");
  return user;
}

export async function createAdminUser(
  sql: Sql,
  input: { username: string; name: string; password: string },
): Promise<AdminAccountDto> {
  try {
    const rows = await sql<AdminUserRow[]>`
      INSERT INTO admin_users (id, username, name, role, password_hash)
      VALUES (${generateId()}, ${input.username}, ${input.name}, 'admin', ${await hashPassword(input.password)})
      RETURNING id, username, name, role, password_hash, disabled, created_at
    `;
    return toAccountDto(rows[0]!);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new AppError("username_taken", "用户名已存在");
    }
    throw error;
  }
}

export async function resetAdminUserPassword(sql: Sql, id: string, password: string): Promise<void> {
  await sql.begin(async (tx) => {
    const user = await getAdminUser(tx, id);
    if (!user) throw notFound();
    await tx`UPDATE admin_users SET password_hash = ${await hashPassword(password)} WHERE id = ${id}`;
    await revokeAdminUserSessions(tx, id);
  });
}

export async function setAdminUserDisabled(
  sql: Sql,
  input: { targetId: string; callerId: string; disabled: boolean },
): Promise<AdminAccountDto> {
  return await sql.begin(async (tx) => {
    const target = await getAdminUser(tx, input.targetId);
    if (!target) throw notFound();
    if (target.id === input.callerId) throw forbidden("不能停用自己的账号");
    if (input.disabled && target.role === "super") {
      const others = await tx<{ count: string }[]>`
        SELECT count(*) FROM admin_users
         WHERE role = 'super' AND id <> ${input.targetId} AND NOT disabled
      `;
      if (Number(others[0]?.count ?? 0) === 0) throw forbidden("至少保留一个启用的超管");
    }
    const rows = await tx<AdminUserRow[]>`
      UPDATE admin_users SET disabled = ${input.disabled} WHERE id = ${input.targetId}
      RETURNING id, username, name, role, password_hash, disabled, created_at
    `;
    if (input.disabled) await revokeAdminUserSessions(tx, input.targetId);
    return toAccountDto(rows[0]!);
  });
}

export async function changeOwnPassword(
  sql: Sql,
  adminUserId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await getAdminUser(sql, adminUserId);
  if (!user) throw unauthorized();
  if (!(await verifyPassword(currentPassword, user.password_hash))) {
    throw new AppError("current_password_mismatch", "当前密码不正确");
  }
  await sql`UPDATE admin_users SET password_hash = ${await hashPassword(newPassword)} WHERE id = ${adminUserId}`;
}
