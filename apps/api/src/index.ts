// 进程入口：加载配置 → 版本化 migration → 单实例监听。migration 成功前不监听，
// readiness（/readyz）始终校验数据库连通。
import "./env";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";

import { loadConfig } from "./config";
import { createSql } from "./db/client";
import { runMigrations } from "./db/migrate";
import { buildApp } from "./app";
import { ensureSuperAdmin } from "./services/accounts";
import { hub } from "./realtime/hub";

const config = loadConfig();
const sql = createSql(config.databaseUrl);

const applied = await runMigrations(sql);
if (applied.length) console.log(`[api] 已应用 migration：${applied.join(", ")}`);
await ensureSuperAdmin(sql, config.adminPassword);

// Docker 部署时前端产物由构建阶段放进 apps/web/dist，随镜像提供
const webDistFromEnv = config.webDistDir;
const defaultDist = fileURLToPath(new URL("../../web/dist", import.meta.url));
const webDistDir = webDistFromEnv ?? (existsSync(`${defaultDist}/index.html`) ? defaultDist : null);

const app = buildApp({ sql, config, webDistDir });
const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[api] mango-write-judge listening on http://localhost:${info.port}`);
  if (webDistDir) console.log(`[api] serving web dist: ${webDistDir}`);
});

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("[api] shutting down…");
  hub.dispose();
  server.close();
  await sql.end();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
