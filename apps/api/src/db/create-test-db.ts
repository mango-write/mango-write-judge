// 创建/重建测试数据库（库名必须 mango_judge_test，防止误指开发库）。
import "../env";
import postgres from "postgres";

const url = process.env.TEST_DATABASE_URL ?? "postgres://judge:judge@localhost:5544/mango_judge_test";
const parsed = new URL(url);
if (parsed.pathname !== "/mango_judge_test") {
  console.error(`测试库名必须是 mango_judge_test，当前：${parsed.pathname}`);
  process.exit(1);
}
const adminUrl = new URL(url);
adminUrl.pathname = "/postgres";
const admin = postgres(adminUrl.toString(), { max: 1 });
await admin`DROP DATABASE IF EXISTS mango_judge_test`;
await admin`CREATE DATABASE mango_judge_test`;
await admin.end();
console.log("mango_judge_test 已重建");
