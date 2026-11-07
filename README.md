# MangoWrite Judge

路演评审系统：**建赛 → 现场评分 → 大屏 → 改分管控 → 冻结 → 导出**。

面向创业大赛、Demo Day、黑客松的线下路演答辩：管理员用桌面端建赛与现场控制，评委用手机评分，大屏实时展示进度与排行。单场比赛、单轮评分、所有评委评所有项目；评分项 `0–10` 分（0.1 步进）加权均分，透明可复算。

- **AGPL-3.0-or-later** 开源（见 [LICENSE](LICENSE) 与 [LICENSING.md](LICENSING.md)）
- 单实例部署：一个 API 进程 + PostgreSQL + Caddy，Docker Compose 一键起
- 不依赖 Redis / 队列 / 对象存储 / 外部 AI；数据只在一个 PostgreSQL 里

## 核心规则（一眼看懂）

| 事项 | 规则 |
|---|---|
| 评分项 | 1–20 个，权重为 1–100 整数百分比，合计必须 100% |
| 评分 | 0–10 分、0.1 步进，0 是有效分；草稿自动保存、不计入成绩 |
| 项目得分 | 已提交评委加权总分的算术平均，half-up 两位小数 |
| 排名 | 分数降序、同分并列（1、1、3），并列按赛前顺序稳定排列 |
| 改分 | 首次公开排行前自由改；公开后旧评分须管理员按「评委 × 项目」单次解锁 |
| 闭幕 | 确认缺评后生成不可变结果快照，所有评分永久锁定，不支持重开 |
| 导出 | 总榜 CSV、评委评分明细 CSV（UTF-8 BOM、公式注入防护） |

## 三端

| 端 | 路径 | 形态 |
|---|---|---|
| 管理端 | `/admin/*` | 桌面优先：列表、设置四区、启动检查、现场控制、结果 |
| 评委端 | `/judge/:slug#token` | 手机优先：评分卡 + 滑块/数字双通道 + 底部操作栏 |
| 大屏端 | `/display/:slug#token` | 固定深色 16:9：进度模式（无任何分数）/ 实时排行 / 最终榜 |

评委与大屏通过一次性链接进入：token 放在 URL fragment，换取 HttpOnly 会话后立即从地址栏移除；丢失链接由管理员轮换重发，轮换即吊销旧会话。

管理端账户：首次启动用 `ADMIN_PASSWORD` 播种超管账号（用户名 `admin`），之后改这个环境变量**不影响**已建账号；超管在「账户管理」新建管理员、重置密码、停用账号（重置/停用即吊销对方会话），所有管理员在页头自行修改密码。管理员与超管的赛事操作权限相同，仅账户管理为超管专属。

## 本地开发

要求：Node.js 24+、pnpm 10+、PostgreSQL 13+。

```bash
git clone https://github.com/<owner>/mango-write-judge.git
cd mango-write-judge
pnpm install --frozen-lockfile
cp .env.example .env      # 填 DATABASE_URL（库需已创建）与 ADMIN_PASSWORD（≥12 位，播种超管初始密码）
pnpm db:migrate
pnpm build                # 构建前端产物（API 会托管）
pnpm dev                  # API :3200 + 前端 :5181（/api 代理到 3200）
```

打开 <http://localhost:5181>，用用户名 `admin`（超管）与 `ADMIN_PASSWORD` 登录。

> 本地没有 PostgreSQL？`docker run -d --name judge-pg -e POSTGRES_USER=judge -e POSTGRES_PASSWORD=judge -e POSTGRES_DB=judge -p 5544:5432 postgres:18`，然后 `DATABASE_URL=postgres://judge:judge@localhost:5544/judge`。

### 测试

```bash
pnpm test        # 单元/DB 测试（不提前启动 E2E）
pnpm build
pnpm --filter @mango-write-judge/e2e exec playwright install chromium
pnpm e2e         # 构建与浏览器准备完成后，单独运行 Playwright 全流程
```

DB 集成测试默认连 `TEST_DATABASE_URL`（缺省 `postgres://judge:judge@localhost:5544/mango_judge_test`），库名硬校验为 `mango_judge_test`，不会误伤开发库。E2E 使用独立的 `judge_e2e` 库并在每次运行前重建。

## 部署（Docker Compose）

```bash
cd deploy
cat > .env <<'EOF'
ADMIN_PASSWORD=<openssl rand -base64 24>
POSTGRES_PASSWORD=<openssl rand -base64 24>
PUBLIC_BASE_URL=https://judge.example.com
JUDGE_DOMAIN=judge.example.com
EOF
docker compose up -d --build
```

`ADMIN_PASSWORD` 只在库中尚无超管时播种一次（用户名 `admin`），登录后请在页头修改密码。

- Caddy 自动签发 HTTPS，SSE 响应不缓冲（`flush_interval -1`）
- API 副本固定 1：SSE Hub 与协同状态在单进程内，不支持多实例扩容
- `VITE_JUDGING_SOURCE_URL` 在构建期注入源码链接（AGPL 网络部署源码提供，见 [LICENSING.md](LICENSING.md)）
- 备份只需 PostgreSQL 数据卷；升级顺序：备份数据库 → 拉新版 → 起容器（migration 在 API 启动前自动执行）

## 技术栈

Vue 3 · [MangoWrite UI](https://github.com/mango-write/mango-write-ui)（Apache-2.0，Git commit 钉版）· Tailwind CSS v4 · Hono · postgres.js · 版本化 SQL migration · Zod 契约 · SSE。计分与排名只有一份实现（`packages/domain`），实时榜、管理端结果、最终快照与 CSV 导出全部经它计算。

## 目录

```
apps/api        Hono API：认证、状态机、评分、SSE、导出（tsx 直跑，无构建）
apps/web        Vue SPA（admin/judge/display 三区）
packages/domain 唯一计分口径：毫位整数 + half-up + 竞赛排名 + 状态机
packages/contracts Zod 请求契约与角色 DTO
e2e             Playwright 全流程
deploy          docker-compose 与 Caddyfile
```

## 许可

AGPL-3.0-or-later。MangoWrite UI 以 Apache-2.0 引用并保留其 NOTICE；网络部署需向用户提供对应源码，详见 [LICENSING.md](LICENSING.md)。参与贡献见 [CONTRIBUTING.md](CONTRIBUTING.md)。
