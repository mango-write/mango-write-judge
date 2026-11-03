import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // DB 集成测试共享一个测试库：文件级串行，避免用例间互相踩 truncate
    // （Vitest 4 移除了 poolOptions.forks.singleFork，用 fileParallelism 收口）
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
