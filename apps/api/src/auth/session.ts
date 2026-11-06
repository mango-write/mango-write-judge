import { getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";

import { generateId, generateToken, hashToken } from "./tokens";
import type { Sql } from "../db/client";

export type SessionRole = "admin" | "judge" | "display";

export const SESSION_COOKIE = "judge_session";

export const ROLE_COOKIES: Record<SessionRole, string> = {
  admin: "judge_admin_session",
  judge: "judge_voter_session",
  display: "judge_display_session",
};

export function getSessionToken(c: Context, role?: SessionRole): string | undefined {
  if (role) {
    const byRole = getCookie(c, ROLE_COOKIES[role]);
    if (byRole) return byRole;
  }
  return getCookie(c, SESSION_COOKIE);
}

export const SESSION_TTL_MS: Record<SessionRole, number> = {
  admin: 12 * 60 * 60 * 1000,
  judge: 48 * 60 * 60 * 1000,
  display: 30 * 24 * 60 * 60 * 1000,
};

export interface SessionRow {
  id: string;
  role: SessionRole;
  event_id: string | null;
  judge_id: string | null;
  expires_at: Date;
}

export async function createSession(
  sql: Sql,
  input: { role: SessionRole; eventId?: string; judgeId?: string },
): Promise<string> {
  const token = generateToken();
  const ttl = SESSION_TTL_MS[input.role];
  await sql`
    INSERT INTO sessions (id, token_hash, role, event_id, judge_id, expires_at)
    VALUES (${generateId()}, ${hashToken(token)}, ${input.role}, ${input.eventId ?? null},
            ${input.judgeId ?? null}, now() + ${ttl} * interval '1 millisecond')
  `;
  return token;
}

export async function lookupSession(sql: Sql, token: string | undefined): Promise<SessionRow | null> {
  if (!token) return null;
  const rows = await sql<SessionRow[]>`
    UPDATE sessions
       SET last_used_at = now(),
           expires_at = CASE
             WHEN expires_at < now() + (expires_at - created_at) / 2 THEN now() + (expires_at - created_at)
             ELSE expires_at END
     WHERE token_hash = ${hashToken(token)} AND expires_at > now()
    RETURNING id, role, event_id, judge_id, expires_at
  `;
  return rows[0] ?? null;
}

export async function revokeSession(sql: Sql, token: string): Promise<void> {
  await sql`DELETE FROM sessions WHERE token_hash = ${hashToken(token)}`;
}

export async function revokeJudgeSessions(sql: Sql, judgeId: string): Promise<void> {
  await sql`DELETE FROM sessions WHERE judge_id = ${judgeId}`;
}

export async function revokeDisplaySessions(sql: Sql, eventId: string): Promise<void> {
  await sql`DELETE FROM sessions WHERE event_id = ${eventId} AND role = 'display'`;
}

export function setSessionCookie(c: Context, token: string, role: SessionRole, secure: boolean): void {
  const opts = {
    httpOnly: true,
    sameSite: "Lax" as const,
    secure,
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS[role] / 1000),
  };
  setCookie(c, ROLE_COOKIES[role], token, opts);
  setCookie(c, SESSION_COOKIE, token, opts);
}

export function clearSessionCookie(c: Context, role?: SessionRole): void {
  const opts = { httpOnly: true, sameSite: "Lax" as const, path: "/", maxAge: 0 };
  if (role) setCookie(c, ROLE_COOKIES[role], "", opts);
  setCookie(c, SESSION_COOKIE, "", opts);
}
