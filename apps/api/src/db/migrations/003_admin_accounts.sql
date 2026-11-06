-- 管理端账户系统：超管/管理员账号；sessions 通过 admin_user_id 关联到人。
-- 迁移前已存在的 admin 会话该列为 NULL，守卫一律按无效处理（升级后需重新登录）。
CREATE TABLE admin_users (
  id text PRIMARY KEY,
  username text NOT NULL UNIQUE,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('super', 'admin')),
  password_hash text NOT NULL,
  disabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sessions ADD COLUMN admin_user_id text REFERENCES admin_users (id) ON DELETE CASCADE;
