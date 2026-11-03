# MangoWrite Judge — Agent 入口

小仓库，一页说完。改动前先读 [README](README.md) 的核心规则表；那是产品行为的权威摘要。

## 仓库地图

| 范围 | 职责 |
|---|---|
| `packages/domain` | 唯一计分口径（毫位整数、half-up、竞赛排名）+ 状态机判定。无框架依赖。 |
| `packages/contracts` | Zod 请求契约、错误码与 HTTP 状态映射、角色 DTO。 |
| `apps/api` | Hono 单实例：三类会话、状态机事务、SSE Hub、CSV 导出。tsx 直跑无构建。 |
| `apps/web` | Vue SPA：`admin/`（桌面）、`judge/`（手机）、`display/`（固定深色大屏）。 |
| `e2e` | Playwright 全流程；自带建库脚本（`run-api.ts` 重建 `judge_e2e`）。 |
| `deploy` | docker-compose + Caddyfile（SSE `flush_interval -1`）。 |

## 反直觉的坑

- **计分公式只有一份**。实时榜、管理端结果、最终快照、CSV 全走 `packages/domain`；在 SQL 或组件里手写 `sum/avg` 就是造第二套口径。
- **分数是整数十分位**（8.7 → 87），聚合在毫位整数域完成，`round half-up` 在整数域实现——别引入浮点。
- **postgres.js 的对象参数必须 `tx.json(x)`**；`sql.begin` 的选项串是拼进 `begin <options>` 的，要写全 `isolation level repeatable read`。
- **SSE 只推 revision**，客户端重拉快照；草稿保存不推。前端 `useRevisionStream` 带 20s 看门狗与连接重建——EventSource 对 401/部分错误不会自动重连，认证完成前不要创建流（大屏/评委的门组件先换会话再挂直播子组件，就是这个原因）。
- **PrimeVue `Dialog` 需要 `:visible` 绑定**，纯 `v-if` 不显示；`InputNumber` 在 blur 才提交模型，E2E 填完要补 Tab。
- **配置写都带 `expectedRevision`**（乐观并发）；`admin` 路由的 404/409/422 语义见 `packages/contracts/src/errors.ts`。
- **测试库硬校验**：`mango_judge_test` / `judge_e2e`，别的库名直接拒绝启动。
- **Vitest 4 没有 `poolOptions.forks.singleFork`**，DB 套件用 `fileParallelism: false` 串行。
- **`@mango-write/ui` 双钉**：`apps/web` 依赖 + 根 `pnpm.overrides` 同一个 Git commit；Tailwind 入口要 `@source` 指进它的 src。

## 验证

```bash
pnpm typecheck && pnpm test && pnpm e2e
```

改 `packages/*` 后先 `pnpm --filter @mango-write-judge/web build` 再手测——API 托管的是构建产物。
