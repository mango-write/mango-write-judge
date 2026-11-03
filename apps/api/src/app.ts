// 应用装配：安全头、Origin 校验、三类角色路由、健康检查、静态托管。
// 静态托管沿用问卷独立站模式：带扩展名的未命中回 404，只有无扩展名导航路径
// 落 SPA fallback（/judge/:slug、/display/:slug 深链可达）。
import { existsSync, readFileSync } from "node:fs";

import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { ZodError } from "zod";

import type { AppConfig } from "./config";
import type { Sql } from "./db/client";
import { AppError } from "./http/errors";
import { originGuard } from "./http/origin";
import { securityHeaders } from "./http/security";
import { createAdminRoutes } from "./routes/admin";
import { createDisplayRoutes } from "./routes/display";
import { createJudgeRoutes } from "./routes/judge";
import type { AppEnv } from "./routes/helpers";

export function buildApp(deps: { sql: Sql; config: AppConfig; webDistDir?: string | null }): Hono<AppEnv> {
  const { sql, config } = deps;
  const app = new Hono<AppEnv>();

  app.use("*", securityHeaders());
  app.use("*", originGuard(config.publicBaseUrl));

  app.get("/healthz", (c) => c.json({ ok: true }));
  app.get("/readyz", async (c) => {
    try {
      await sql`SELECT 1`;
      return c.json({ ok: true });
    } catch {
      return c.json({ ok: false }, 503);
    }
  });

  app.route("/api/admin", createAdminRoutes({ sql, config }));
  app.route("/api/judge", createJudgeRoutes({ sql, config }));
  app.route("/api/display", createDisplayRoutes({ sql, config }));

  app.onError((error, c) => {
    if (error instanceof AppError) {
      return c.json({ error: { code: error.code, message: error.message, details: error.details } }, error.status);
    }
    if (error instanceof ZodError) {
      return c.json(
        { error: { code: "validation_error", message: error.issues[0]?.message ?? "请求参数不合法" } },
        400,
      );
    }
    console.error("[api] unhandled error:", error);
    return c.json({ error: { code: "internal_error", message: "服务内部错误" } }, 500);
  });

  app.notFound((c) => {
    if (c.req.path.startsWith("/api/") || /\.[\w]+$/.test(c.req.path)) {
      return c.json({ error: { code: "not_found", message: "资源不存在" } }, 404);
    }
    const webDist = deps.webDistDir ?? null;
    if (webDist && existsSync(`${webDist}/index.html`)) {
      return c.html(readFileSync(`${webDist}/index.html`, "utf8"));
    }
    return c.json({ error: { code: "not_found", message: "资源不存在" } }, 404);
  });

  const webDist = deps.webDistDir ?? null;
  if (webDist && existsSync(`${webDist}/index.html`)) {
    app.use("*", serveStatic({ root: webDist }));
  }

  return app;
}
