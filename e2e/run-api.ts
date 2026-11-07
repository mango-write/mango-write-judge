// E2E API 启动器：重建 judge_e2e 库 → migration → 单实例 API（:3210）。
// webServer 在 globalSetup 之前启动，所以建库必须在这一步完成。
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

import { E2E_ADMIN_PASSWORD, E2E_DATABASE_URL, E2E_PORT } from "./env";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const parsed = new URL(E2E_DATABASE_URL);
if (parsed.pathname !== "/judge_e2e") {
  throw new Error(`E2E 库名必须是 judge_e2e，当前：${parsed.pathname}`);
}

const adminUrl = new URL(E2E_DATABASE_URL);
adminUrl.pathname = "/postgres";
const admin = postgres(adminUrl.toString(), { max: 1 });
await admin`DROP DATABASE IF EXISTS judge_e2e`;
await admin`CREATE DATABASE judge_e2e`;
await admin.end();

execFileSync("pnpm", ["--filter", "@mango-write-judge/api", "exec", "tsx", "src/db/migrate-cli.ts"], {
  cwd: repoRoot,
  env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL },
  stdio: "inherit",
});

const child = spawn("pnpm", ["--filter", "@mango-write-judge/api", "exec", "tsx", "src/index.ts"], {
  cwd: repoRoot,
  env: {
    ...process.env,
    DATABASE_URL: E2E_DATABASE_URL,
    ADMIN_PASSWORD: E2E_ADMIN_PASSWORD,
    PUBLIC_BASE_URL: `http://localhost:${E2E_PORT}`,
    PORT: E2E_PORT,
  },
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => child.kill(signal));
}
