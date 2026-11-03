import "../env";

import { createSql } from "./client";
import { runMigrations } from "./migrate";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("缺少环境变量 DATABASE_URL（见 .env.example）");
  process.exit(1);
}
const sql = createSql(databaseUrl, 2);
try {
  const applied = await runMigrations(sql);
  console.log(applied.length ? `已应用 migration：${applied.join(", ")}` : "数据库已是最新结构");
} finally {
  await sql.end();
}
