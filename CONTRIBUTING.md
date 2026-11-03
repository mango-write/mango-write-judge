# 贡献指南

欢迎 issue 与 PR。这是一个小而完整的单仓 monorepo，动手前请先跑通本地环境（见 [README](README.md)）。

## 开发约定

- **包结构**：`packages/domain` 是唯一计分口径，`packages/contracts` 是 API 契约；不要在 `apps/api`、`apps/web` 或 SQL 里另写计分/舍入公式。
- **状态机**：比赛 `draft → judging → closed` 单向；改分管控（reveal/解锁）的判定集中在 `packages/domain/src/state.ts`，服务端与前端权限提示共用同一语义。
- **数据库**：只改 `apps/api/src/db/migrations/`（版本化 SQL，只增不改已应用文件）；migration 在 API 启动时自动执行。
- **实时**：SSE 只推 `{revision}`，客户端重拉角色快照；草稿保存不推进 revision。
- **安全基线**：新增接口默认经角色中间件；跨比赛资源一律 404；写请求校验 Origin；用户文本一律纯文本渲染（不要引入 v-html）；CSV 输出走 `packages/domain` 的注入防护。
- **UI**：复用 `@mango-write/ui`（Apache-2.0 子仓）的设计 token 与组件；升级它需要同时更新 `apps/web/package.json` 的依赖与根 `pnpm.overrides` 两处并重钉 commit。

## 提交前

```bash
pnpm typecheck   # 全仓类型
pnpm test        # 单测 + DB 集成 + 组件测试
pnpm e2e         # 全流程（需要本地 PostgreSQL）
```

提交信息用 `type(scope): 摘要`（如 `feat(api): …`、`fix(web): …`）。

## 许可

提交即表示你同意以 AGPL-3.0-or-later 授权你的贡献。
