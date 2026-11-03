import { Hono } from "hono";
import { getCookie } from "hono/cookie";

import { judgeSessionRequest, saveDraftRequest, submitScoresRequest } from "@mango-write-judge/contracts";
import { hashToken } from "../auth/tokens";

import {
  SESSION_COOKIE,
  clearSessionCookie,
  createSession,
  revokeSession,
  setSessionCookie,
} from "../auth/session";
import type { Sql } from "../db/client";
import { AppError, notFound } from "../http/errors";
import { createRateLimiter } from "../http/rate-limit";
import { saveDraft, submitScores } from "../services/evaluations";
import { getJudgeSnapshot } from "../services/snapshots";
import { readJson, clientIp, requireRole, type AppEnv, type RouteDeps } from "./helpers";
import { sseResponse } from "./sse";

/** token 换会话：失败一律 404，不泄露链接是否曾经有效。 */
async function exchangeToken(sql: Sql, token: string): Promise<{ eventId: string; judgeId: string; name: string; eventName: string; slug: string }> {
  const rows = await sql<
    { event_id: string; judge_id: string; name: string; event_name: string; slug: string; status: string }[]
  >`
    SELECT j.event_id, j.id AS judge_id, j.name, e.name AS event_name, e.slug, e.status
      FROM judges j JOIN events e ON e.id = j.event_id
     WHERE j.token_hash = ${hashToken(token)}`;
  const row = rows[0];
  if (!row) throw notFound("邀请链接无效或已被重置");
  return {
    eventId: row.event_id,
    judgeId: row.judge_id,
    name: row.name,
    eventName: row.event_name,
    slug: row.slug,
  };
}

export function createJudgeRoutes(deps: RouteDeps): Hono<AppEnv> {
  const { sql, config } = deps;
  const exchangeLimiter = createRateLimiter();
  const writeLimiter = createRateLimiter();
  const app = new Hono<AppEnv>();

  app.post("/session", async (c) => {
    const body = await readJson(c, judgeSessionRequest);
    const limit = exchangeLimiter.check(`exchange:${clientIp(c)}`, 10, 60_000);
    if (!limit.allowed) throw new AppError("rate_limited", "尝试过于频繁，请稍后再试");
    const judge = await exchangeToken(sql, body.token);
    const token = await createSession(sql, { role: "judge", eventId: judge.eventId, judgeId: judge.judgeId });
    setSessionCookie(c, token, "judge", config.secureCookies);
    return c.json({ ok: true, event: { name: judge.eventName, slug: judge.slug }, judge: { name: judge.name } });
  });

  app.delete("/session", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await revokeSession(sql, token);
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  app.use("*", async (c, next) => {
    c.set("judgeSession", await requireRole(c, sql, "judge"));
    await next();
  });

  app.get("/snapshot", async (c) => {
    const session = c.get("judgeSession");
    return c.json(await getJudgeSnapshot(sql, session.event_id!, session.judge_id!));
  });

  const writeLimit = (sessionId: string) => writeLimiter.check(`judge-write:${sessionId}`, 120, 60_000);

  app.put("/projects/:projectId/draft", async (c) => {
    const session = c.get("judgeSession");
    const limit = writeLimit(session.id);
    if (!limit.allowed) throw new AppError("rate_limited", "操作过于频繁，请稍后再试");
    const body = await readJson(c, saveDraftRequest);
    return c.json(
      await saveDraft(sql, {
        eventId: session.event_id!,
        judgeId: session.judge_id!,
        projectId: c.req.param("projectId"),
        scores: body.scores,
        expectedVersion: body.expectedVersion,
      }),
    );
  });

  app.post("/projects/:projectId/submit", async (c) => {
    const session = c.get("judgeSession");
    const limit = writeLimit(session.id);
    if (!limit.allowed) throw new AppError("rate_limited", "操作过于频繁，请稍后再试");
    const body = await readJson(c, submitScoresRequest);
    return c.json(
      await submitScores(sql, {
        eventId: session.event_id!,
        judgeId: session.judge_id!,
        projectId: c.req.param("projectId"),
        scores: body.scores,
        expectedVersion: body.expectedVersion,
        operationId: body.operationId,
      }),
    );
  });

  app.get("/stream", async (c) => {
    const session = c.get("judgeSession");
    const eventId = session.event_id!;
    return sseResponse(c, {
      eventId,
      currentRevision: async () => (await getJudgeSnapshot(sql, eventId, session.judge_id!)).revision,
    });
  });

  return app;
}
