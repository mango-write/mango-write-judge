import postgres from "postgres";

// 单实例 API：连接池上限留足余量（业务写事务都会短暂持有 event 行锁）。
export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

export function createSql(databaseUrl: string, max = 20): Sql {
  return postgres(databaseUrl, {
    max,
    idle_timeout: 20,
    connect_timeout: 10,
    // 时间戳一律 timestamptz；JS Date 与 PG 精度差异在毫位整数口径外，无影响
    types: {},
  });
}
