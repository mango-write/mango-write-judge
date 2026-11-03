import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { Sql } from "./client";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));

/** 全部业务表名，测试间清库用（不含 schema_migrations）。 */
export const APP_TABLES = [
  "audit_logs",
  "result_snapshots",
  "evaluation_commands",
  "evaluation_unlocks",
  "evaluation_revisions",
  "evaluation_items",
  "evaluations",
  "sessions",
  "judges",
  "projects",
  "criteria",
  "events",
] as const;

interface MigrationFile {
  version: number;
  name: string;
  path: string;
}

function listMigrations(): MigrationFile[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .map((file) => {
      const match = /^(\d+)_(.+)\.sql$/.exec(file);
      if (!match) throw new Error(`非法 migration 文件名：${file}`);
      return { version: Number(match[1]), name: match[2]!, path: `${MIGRATIONS_DIR}/${file}` };
    })
    .sort((a, b) => a.version - b.version);
}

/** 版本化 SQL migration：advisory lock 防并发，逐个事务应用，已应用跳过。 */
export async function runMigrations(sql: Sql): Promise<string[]> {
  const applied: string[] = [];
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    version integer PRIMARY KEY,
    name text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`;
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(918273645)`;
    const existing = new Set(
      (await tx<{ version: number }[]>`SELECT version FROM schema_migrations`).map((row) => row.version),
    );
    for (const migration of listMigrations()) {
      if (existing.has(migration.version)) continue;
      const content = readFileSync(migration.path, "utf8");
      await tx.unsafe(content);
      await tx`INSERT INTO schema_migrations (version, name) VALUES (${migration.version}, ${migration.name})`;
      applied.push(`${migration.version}_${migration.name}`);
    }
  });
  return applied;
}
