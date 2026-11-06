-- 保存大屏与评委的邀请 token，使主办方可随时重新查看二维码/复制链接/导出邀请卡，
-- 无需每次查看都强制重置并踢掉现场已连接会话；泄露时仍可手动轮换。
ALTER TABLE events ADD COLUMN IF NOT EXISTS display_token text NOT NULL DEFAULT '';
ALTER TABLE judges ADD COLUMN IF NOT EXISTS invite_token text NOT NULL DEFAULT '';
