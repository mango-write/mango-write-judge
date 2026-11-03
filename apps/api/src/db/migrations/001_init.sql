-- MangoWrite Judge 初始结构。
-- 口径：分数整数十分位（score_tenths），权重整数百分比；不存任何派生总分列，
-- 实时榜/结果/快照/导出一律经 @mango-write-judge/domain 同一实现现算。
-- 时间全部 timestamptz（UTC）；revision 与业务写在同一事务递增。

CREATE TABLE events (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'judging', 'closed')),
  active_project_id text,
  display_mode text NOT NULL DEFAULT 'progress' CHECK (display_mode IN ('progress', 'ranking')),
  revealed_at timestamptz,
  revision integer NOT NULL DEFAULT 0,
  display_token_hash text NOT NULL,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE criteria (
  id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  weight_percent integer NOT NULL CHECK (weight_percent BETWEEN 1 AND 100),
  position integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX criteria_event_idx ON criteria (event_id, position);

CREATE TABLE projects (
  id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  name text NOT NULL,
  team_name text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  position integer NOT NULL,
  unlocked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX projects_event_idx ON projects (event_id, position);

CREATE TABLE judges (
  id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX judges_event_idx ON judges (event_id);

-- 会话覆盖三类角色；数据库只存 token 的 SHA-256，API 重启后会话仍有效。
CREATE TABLE sessions (
  id text PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('admin', 'judge', 'display')),
  event_id text REFERENCES events (id) ON DELETE CASCADE,
  judge_id text REFERENCES judges (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

-- 评分：evaluations 是「评委 × 项目」唯一行；evaluation_items 是工作副本（草稿
-- 或最近提交值），正式成绩只认 evaluation_revisions 的不可变快照。
CREATE TABLE evaluations (
  id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  judge_id text NOT NULL REFERENCES judges (id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  version integer NOT NULL DEFAULT 0,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (judge_id, project_id)
);
CREATE INDEX evaluations_event_idx ON evaluations (event_id);
CREATE INDEX evaluations_project_idx ON evaluations (project_id);

CREATE TABLE evaluation_items (
  evaluation_id text NOT NULL REFERENCES evaluations (id) ON DELETE CASCADE,
  criterion_id text NOT NULL REFERENCES criteria (id) ON DELETE CASCADE,
  score_tenths integer NOT NULL CHECK (score_tenths BETWEEN 0 AND 100),
  PRIMARY KEY (evaluation_id, criterion_id)
);

CREATE TABLE evaluation_revisions (
  id text PRIMARY KEY,
  evaluation_id text NOT NULL REFERENCES evaluations (id) ON DELETE CASCADE,
  version integer NOT NULL,
  items jsonb NOT NULL,
  content_hash text NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (evaluation_id, version)
);

-- 单次解锁：同时最多一个有效（未撤销、未使用），由部分唯一索引兜底并发。
CREATE TABLE evaluation_unlocks (
  id text PRIMARY KEY,
  evaluation_id text NOT NULL REFERENCES evaluations (id) ON DELETE CASCADE,
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  used_at timestamptz
);
CREATE UNIQUE INDEX evaluation_unlocks_active_uniq
  ON evaluation_unlocks (evaluation_id)
  WHERE revoked_at IS NULL AND used_at IS NULL;

-- 正式提交幂等：同一 operationId 重试返回缓存响应，载荷不一致则 409。
CREATE TABLE evaluation_commands (
  evaluation_id text NOT NULL REFERENCES evaluations (id) ON DELETE CASCADE,
  operation_id text NOT NULL,
  payload_hash text NOT NULL,
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (evaluation_id, operation_id)
);

-- 闭幕不可变结果快照：最终榜只读这里，不重算。
CREATE TABLE result_snapshots (
  event_id text PRIMARY KEY REFERENCES events (id) ON DELETE CASCADE,
  algorithm_version text NOT NULL,
  result_hash text NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 审计：启动、切屏、公开排行、解锁、撤销、闭幕、导出、令牌轮换等管理操作。
CREATE TABLE audit_logs (
  id text PRIMARY KEY,
  event_id text REFERENCES events (id) ON DELETE CASCADE,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_event_idx ON audit_logs (event_id, created_at);
