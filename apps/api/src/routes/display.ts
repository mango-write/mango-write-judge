import { Hono } from "hono";

import { displaySessionRequest } from "@mango-write-judge/contracts";
import { hashToken } from "../auth/tokens";

import {
  clearSessionCookie,
  createSession,
  getSessionToken,
  revokeSession,
  setSessionCookie,
} from "../auth/session";
import { AppError, notFound } from "../http/errors";
import { createRateLimiter } from "../http/rate-limit";
import { getDisplaySnapshot } from "../services/snapshots";
import { getEvent } from "../services/shared";
import { clientIp, readJson, requireRole, type AppEnv, type RouteDeps } from "./helpers";
import { sseResponse } from "./sse";

export function createDisplayRoutes(deps: RouteDeps): Hono<AppEnv> {
  const { sql, config } = deps;
  const exchangeLimiter = createRateLimiter();
  const app = new Hono<AppEnv>();

  app.post("/session", async (c) => {
    const body = await readJson(c, displaySessionRequest);
    const limit = exchangeLimiter.check(`display-exchange:${clientIp(c)}`, 10, 60_000);
    if (!limit.allowed) throw new AppError("rate_limited", "尝试过于频繁，请稍后再试");
    const rows = await sql<{ id: string; name: string }[]>`
      SELECT id, name FROM events WHERE display_token_hash = ${hashToken(body.token)}`;
    const event = rows[0];
    if (!event) throw notFound("大屏链接无效或已被重置");
    const token = await createSession(sql, { role: "display", eventId: event.id });
    setSessionCookie(c, token, "display", config.secureCookies);
    return c.json({ ok: true, event: { name: event.name } });
  });

  app.delete("/session", async (c) => {
    const token = getSessionToken(c, "display");
    if (token) await revokeSession(sql, token);
    clearSessionCookie(c, "display");
    return c.json({ ok: true });
  });

  app.use("*", async (c, next) => {
    c.set("displaySession", await requireRole(c, sql, "display"));
    await next();
  });

  app.get("/snapshot", async (c) => {
    const session = c.get("displaySession");
    return c.json(await getDisplaySnapshot(sql, session.event_id!));
  });

  app.get("/stream", async (c) => {
    const session = c.get("displaySession");
    const eventId = session.event_id!;
    await getEvent(sql, eventId);
    return sseResponse(c, {
      eventId,
      currentRevision: async () => (await getEvent(sql, eventId)).revision,
    });
  });

  return app;
}
