// 测试库支撑：独立于开发库（库名硬校验），每套件truncate 而非重建。
import postgres from "postgres";

import { createSql, type Sql } from "../db/client";
import { APP_TABLES, runMigrations } from "../db/migrate";

const TEST_URL = process.env.TEST_DATABASE_URL ?? "postgres://judge:judge@localhost:5544/mango_judge_test";

function guardTestUrl(): void {
  const name = new URL(TEST_URL).pathname.replace(/^\//, "");
  if (name !== "mango_judge_test") {
    throw new Error(`测试库名必须是 mango_judge_test，当前：${name}（拒绝在非测试库上跑集成测试）`);
  }
}

let sqlPromise: Promise<Sql> | null = null;

export function testSql(): Promise<Sql> {
  if (!sqlPromise) {
    guardTestUrl();
    sqlPromise = (async () => {
      const adminUrl = new URL(TEST_URL);
      adminUrl.pathname = "/postgres";
      const admin = postgres(adminUrl.toString(), { max: 1 });
      const exists = await admin`SELECT 1 FROM pg_database WHERE datname = 'mango_judge_test'`;
      if (!exists[0]) await admin`CREATE DATABASE mango_judge_test`;
      await admin.end();
      const sql = createSql(TEST_URL, 10);
      await runMigrations(sql);
      return sql;
    })();
  }
  return sqlPromise;
}

export async function resetDb(sql: Sql): Promise<void> {
  await sql.unsafe(`TRUNCATE TABLE ${APP_TABLES.join(", ")} RESTART IDENTITY CASCADE`);
}

export const TEST_ADMIN_PASSWORD = "test-password-123456";
