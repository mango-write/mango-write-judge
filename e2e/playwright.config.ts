import { defineConfig } from "@playwright/test";

import { E2E_BASE_URL } from "./env";

// E2E：webServer 命令自带建库与 migration（webServer 先于 globalSetup 启动）。
// 前置：pnpm install && pnpm build && npx playwright install chromium。
export default defineConfig({
  testDir: ".",
  timeout: 300_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: E2E_BASE_URL,
  },
  webServer: {
    command: "pnpm --filter @mango-write-judge/api exec tsx ../../e2e/run-api.ts",
    url: `${E2E_BASE_URL}/readyz`,
    reuseExistingServer: false,
    timeout: 90_000,
  },
});
