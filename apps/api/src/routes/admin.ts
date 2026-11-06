import { Hono } from "hono";

import {
  activeProjectRequest,
  closeEventRequest,
  createCriterionRequest,
  createEventRequest,
  createJudgeRequest,
  createProjectRequest,
  displayModeRequest,
  patchCriterionRequest,
  patchEventRequest,
  patchJudgeRequest,
  patchProjectRequest,
  reorderRequest,
  adminLoginRequest,
} from "@mango-write-judge/contracts";

import {
  clearSessionCookie,
  createSession,
  getSessionToken,
  revokeSession,
  setSessionCookie,
} from "../auth/session";
import { AppError, unauthorized } from "../http/errors";
import { createRateLimiter } from "../http/rate-limit";
import {
  closeEvent,
  createEvent,
  deleteEvent,
  getEventDetail,
  listEvents,
  patchEvent,
  setActiveProject,
  setDisplayMode,
  startEvent,
  unlockAllProjects,
} from "../services/events";
import {
  createCriterion,
  createJudge,
  createProject,
  deleteCriterion,
  deleteJudge,
  deleteProject,
  importJudgesCsv,
  importProjectsCsv,
  judgeInviteUrl,
  patchCriterion,
  patchJudge,
  patchProject,
  reorderCriteria,
  reorderProjects,
  rotateDisplayToken,
  rotateJudgeToken,
} from "../services/config";
import { revokeUnlock, unlockAllEvaluations, unlockEvaluation } from "../services/evaluations";
import { exportResultsCsv, exportScoresCsv } from "../services/exports";
import { getAdminSnapshot } from "../services/snapshots";
import { getEvent } from "../services/shared";
import { adminGuard, clientIp, constantTimeEqual, readJson, type AppEnv, type RouteDeps } from "./helpers";
import { sseResponse } from "./sse";

const LOGIN_LIMIT = 5;
const LOGIN_WINDOW_MS = 60_000;

export function createAdminRoutes(deps: RouteDeps): Hono<AppEnv> {
  const { sql, config } = deps;
  const loginLimiter = createRateLimiter();
  const app = new Hono<AppEnv>();

  app.post("/login", async (c) => {
    const body = await readJson(c, adminLoginRequest);
    const limit = loginLimiter.check(`login:${clientIp(c)}`, LOGIN_LIMIT, LOGIN_WINDOW_MS);
    if (!limit.allowed) {
      c.header("Retry-After", String(Math.max(1, limit.retryAfterSec)));
      throw new AppError("rate_limited", "尝试过于频繁，请稍后再试");
    }
    if (!constantTimeEqual(body.password, config.adminPassword)) throw unauthorized("密码错误");
    const token = await createSession(sql, { role: "admin" });
    setSessionCookie(c, token, "admin", config.secureCookies);
    return c.json({ ok: true });
  });

  app.post("/logout", async (c) => {
    const token = getSessionToken(c, "admin");
    if (token) await revokeSession(sql, token);
    clearSessionCookie(c, "admin");
    return c.json({ ok: true });
  });

  app.use("*", adminGuard(sql));

  app.get("/session", (c) => c.json({ ok: true }));

  app.get("/events", async (c) => c.json({ events: await listEvents(sql) }));

  app.post("/events", async (c) => {
    const body = await readJson(c, createEventRequest);
    return c.json(await createEvent(sql, body, config.inviteBaseUrl), 201);
  });

  app.get("/events/:id", async (c) => c.json(await getEventDetail(sql, c.req.param("id"), config.inviteBaseUrl)));

  app.patch("/events/:id", async (c) => {
    const body = await readJson(c, patchEventRequest);
    return c.json(await patchEvent(sql, c.req.param("id"), body, config.inviteBaseUrl));
  });

  app.delete("/events/:id", async (c) => {
    await deleteEvent(sql, c.req.param("id"));
    return c.json({ ok: true });
  });

  app.post("/events/:id/start", async (c) => c.json(await startEvent(sql, c.req.param("id"))));

  app.post("/events/:id/active-project", async (c) => {
    const body = await readJson(c, activeProjectRequest);
    return c.json(await setActiveProject(sql, c.req.param("id"), body.projectId));
  });

  app.post("/events/:id/projects/unlock-all", async (c) => {
    return c.json(await unlockAllProjects(sql, c.req.param("id")));
  });

  app.post("/events/:id/display-mode", async (c) => {
    const body = await readJson(c, displayModeRequest);
    return c.json(await setDisplayMode(sql, c.req.param("id"), body.mode, body.confirmReveal === true));
  });

  app.post("/events/:id/close", async (c) => {
    await readJson(c, closeEventRequest);
    return c.json(await closeEvent(sql, c.req.param("id")));
  });

  app.get("/events/:id/snapshot", async (c) =>
    c.json(await getAdminSnapshot(sql, c.req.param("id"), config.inviteBaseUrl)),
  );

  app.get("/events/:id/stream", async (c) => {
    const eventId = c.req.param("id");
    await getEvent(sql, eventId); // 404 早于挂流
    return sseResponse(c, {
      eventId,
      currentRevision: async () => (await getEvent(sql, eventId)).revision,
    });
  });

  // ---------- 评分项 ----------

  app.post("/events/:id/criteria", async (c) => {
    const eventId = c.req.param("id");
    const body = await readJson(c, createCriterionRequest);
    const revision = await createCriterion(sql, eventId, { ...body, expectedRevision: body.expectedRevision });
    return c.json({ revision }, 201);
  });

  app.patch("/events/:id/criteria/:criterionId", async (c) => {
    const body = await readJson(c, patchCriterionRequest);
    const revision = await patchCriterion(sql, c.req.param("id"), c.req.param("criterionId"), {
      ...body,
      expectedRevision: body.expectedRevision,
    });
    return c.json({ revision });
  });

  app.delete("/events/:id/criteria/:criterionId", async (c) => {
    const expectedRevision = Number(c.req.query("expectedRevision"));
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw new AppError("validation_error", "缺少 expectedRevision 查询参数");
    }
    return c.json({ revision: await deleteCriterion(sql, c.req.param("id"), c.req.param("criterionId"), expectedRevision) });
  });

  app.post("/events/:id/criteria/reorder", async (c) => {
    const body = await readJson(c, reorderRequest);
    return c.json({ revision: await reorderCriteria(sql, c.req.param("id"), body.ids, body.expectedRevision) });
  });

  // ---------- 项目 ----------

  app.post("/events/:id/projects", async (c) => {
    const body = await readJson(c, createProjectRequest);
    return c.json({ revision: await createProject(sql, c.req.param("id"), body) }, 201);
  });

  app.patch("/events/:id/projects/:projectId", async (c) => {
    const body = await readJson(c, patchProjectRequest);
    return c.json({ revision: await patchProject(sql, c.req.param("id"), c.req.param("projectId"), body) });
  });

  app.delete("/events/:id/projects/:projectId", async (c) => {
    const expectedRevision = Number(c.req.query("expectedRevision"));
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw new AppError("validation_error", "缺少 expectedRevision 查询参数");
    }
    return c.json({
      revision: await deleteProject(sql, c.req.param("id"), c.req.param("projectId"), expectedRevision),
    });
  });

  app.post("/events/:id/projects/reorder", async (c) => {
    const body = await readJson(c, reorderRequest);
    return c.json({ revision: await reorderProjects(sql, c.req.param("id"), body.ids, body.expectedRevision) });
  });

  app.post("/events/:id/projects/import", async (c) => {
    const expectedRevision = Number(c.req.query("expectedRevision"));
    const body = await c.req.parseBody().catch(() => null);
    const file = body?.file;
    if (!(file instanceof File)) throw new AppError("validation_error", "缺少 file 字段（CSV 文件）");
    if (file.size > 1024 * 1024) throw new AppError("payload_too_large", "导入文件超过 1MiB");
    return c.json(await importProjectsCsv(sql, c.req.param("id"), await file.text(), expectedRevision));
  });

  // ---------- 评委 ----------

  app.post("/events/:id/judges", async (c) => {
    const eventId = c.req.param("id");
    const event = await getEvent(sql, eventId);
    const body = await readJson(c, createJudgeRequest);
    return c.json(
      await createJudge(sql, config.inviteBaseUrl, event.slug, eventId, {
        name: body.name,
        expectedRevision: body.expectedRevision,
      }),
      201,
    );
  });

  app.patch("/events/:id/judges/:judgeId", async (c) => {
    const body = await readJson(c, patchJudgeRequest);
    return c.json({
      revision: await patchJudge(sql, c.req.param("id"), c.req.param("judgeId"), {
        name: body.name,
        expectedRevision: body.expectedRevision,
      }),
    });
  });

  app.delete("/events/:id/judges/:judgeId", async (c) => {
    const expectedRevision = Number(c.req.query("expectedRevision"));
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw new AppError("validation_error", "缺少 expectedRevision 查询参数");
    }
    return c.json({
      revision: await deleteJudge(sql, c.req.param("id"), c.req.param("judgeId"), expectedRevision),
    });
  });

  app.post("/events/:id/judges/import", async (c) => {
    const eventId = c.req.param("id");
    const event = await getEvent(sql, eventId);
    const expectedRevision = Number(c.req.query("expectedRevision"));
    const body = await c.req.parseBody().catch(() => null);
    const file = body?.file;
    if (!(file instanceof File)) throw new AppError("validation_error", "缺少 file 字段（CSV 文件）");
    if (file.size > 1024 * 1024) throw new AppError("payload_too_large", "导入文件超过 1MiB");
    return c.json(
      await importJudgesCsv(sql, config.inviteBaseUrl, event.slug, eventId, await file.text(), expectedRevision),
    );
  });

  app.post("/events/:id/judges/:judgeId/rotate-token", async (c) => {
    const invite = await rotateJudgeToken(sql, config.inviteBaseUrl, c.req.param("id"), c.req.param("judgeId"));
    return c.json(invite);
  });

  app.post("/events/:id/display-token/rotate", async (c) => {
    return c.json(await rotateDisplayToken(sql, config.inviteBaseUrl, c.req.param("id")));
  });

  // ---------- 解锁 ----------

  app.post("/events/:id/evaluations/unlock-all", async (c) => {
    return c.json(await unlockAllEvaluations(sql, c.req.param("id")));
  });

  app.post("/events/:id/evaluations/:evaluationId/unlock", async (c) => {
    return c.json(await unlockEvaluation(sql, c.req.param("id"), c.req.param("evaluationId")));
  });

  app.delete("/events/:id/evaluations/:evaluationId/unlock", async (c) => {
    return c.json(await revokeUnlock(sql, c.req.param("id"), c.req.param("evaluationId")));
  });

  // ---------- 导出 ----------

  app.get("/events/:id/export/results.csv", async (c) => {
    const export_ = await exportResultsCsv(sql, c.req.param("id"));
    return csvResponse(c, export_.filename, export_.body);
  });

  app.get("/events/:id/export/scores.csv", async (c) => {
    const export_ = await exportScoresCsv(sql, c.req.param("id"));
    return csvResponse(c, export_.filename, export_.body);
  });

  return app;
}

function csvResponse(c: import("hono").Context, filename: string, body: string): Response {
  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="${filename}"`);
  return c.body(body);
}
