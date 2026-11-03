import { beforeEach, describe, expect, it } from "vitest";

import { errorOf } from "./test-support/app";
import { TEST_ADMIN_PASSWORD } from "./test-support/db";
import { createHarness, displayClient, judgeClient, seedEvent, type Harness } from "./test-support/harness";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

describe("管理员认证", () => {
  it("正确密码登录获得会话；错误密码 401", async () => {
    const good = harness.freshClient();
    const ok = await good.post("/api/admin/login", { password: TEST_ADMIN_PASSWORD });
    expect(ok.status).toBe(200);
    const list = await good.get("/api/admin/events");
    expect(list.status).toBe(200);

    const bad = harness.freshClient();
    expect((await bad.post("/api/admin/login", { password: "wrong" })).status).toBe(401);
    expect((await bad.get("/api/admin/events")).status).toBe(401);
  });

  it("登录限流：每 IP 每分钟 5 次，第 6 次 429", async () => {
    const client = harness.freshClient();
    for (let i = 0; i < 5; i++) {
      await client.post("/api/admin/login", { password: "wrong" });
    }
    const limited = await client.post("/api/admin/login", { password: "wrong" });
    expect(limited.status).toBe(429);
    expect(errorOf(limited).code).toBe("rate_limited");
  });

  it("登出吊销会话", async () => {
    const client = harness.freshClient();
    await client.post("/api/admin/login", { password: TEST_ADMIN_PASSWORD });
    expect((await client.post("/api/admin/logout")).status).toBe(200);
    expect((await client.get("/api/admin/events")).status).toBe(401);
  });
});

describe("评委与大屏 token 换会话", () => {
  it("无效 token 一律 404，不泄露有效性", async () => {
    const seed = await seedEvent(harness, { criteria: [["A", 100]], projects: ["P1"], judges: ["J1"] });
    const client = harness.freshClient();
    const miss = await client.post("/api/judge/session", { token: "x".repeat(43) });
    expect(miss.status).toBe(404);
    const ok = await client.post("/api/judge/session", { token: seed.judges[0]!.token });
    expect(ok.status).toBe(200);
    expect((await client.post("/api/display/session", { token: seed.judges[0]!.token })).status).toBe(404);
  });

  it("轮换评委 token：旧 token 失效、旧会话吊销、新链接可用", async () => {
    const seed = await seedEvent(harness, { criteria: [["A", 100]], projects: ["P1"], judges: ["J1"] });
    const oldClient = await judgeClient(harness, seed.judges[0]!.token);
    const rotated = await harness.admin.post<{ inviteUrl: string }>(
      `/api/admin/events/${seed.eventId}/judges/${seed.judges[0]!.id}/rotate-token`,
    );
    expect(rotated.status).toBe(200);
    expect((await oldClient.get("/api/judge/snapshot")).status).toBe(401);
    expect((await harness.freshClient().post("/api/judge/session", { token: seed.judges[0]!.token })).status).toBe(404);
    const newClient = await judgeClient(harness, rotated.body.inviteUrl.split("#")[1]!);
    expect((await newClient.get("/api/judge/snapshot")).status).toBe(200);
  });

  it("轮换大屏 token：旧会话失效", async () => {
    const seed = await seedEvent(harness, { criteria: [["A", 100]], projects: ["P1"], judges: ["J1"] });
    const oldClient = await displayClient(harness, seed.displayToken);
    expect((await oldClient.get("/api/display/snapshot")).status).toBe(200);
    const rotated = await harness.admin.post<{ inviteUrl: string }>(`/api/admin/events/${seed.eventId}/display-token/rotate`);
    expect((await oldClient.get("/api/display/snapshot")).status).toBe(401);
    const newClient = await displayClient(harness, rotated.body.inviteUrl.split("#")[1]!);
    expect((await newClient.get("/api/display/snapshot")).status).toBe(200);
  });
});

describe("角色隔离", () => {
  it("评委/大屏/管理员会话互不可用对方接口", async () => {
    const seed = await seedEvent(harness, { criteria: [["A", 100]], projects: ["P1"], judges: ["J1"] });
    const judge = await judgeClient(harness, seed.judges[0]!.token);
    expect((await judge.get("/api/admin/events")).status).toBe(401);
    expect((await judge.get("/api/display/snapshot")).status).toBe(401);

    const display = await displayClient(harness, seed.displayToken);
    expect((await display.get("/api/judge/snapshot")).status).toBe(401);
    expect((await display.get("/api/admin/events")).status).toBe(401);

    expect((await harness.admin.get("/api/judge/snapshot")).status).toBe(401);
  });

  it("跨比赛资源 404：用 A 比赛会话访问 B 比赛资源", async () => {
    const seedA = await seedEvent(harness, { criteria: [["A", 100]], projects: ["P1"], judges: ["J1"], slug: "event-a" });
    const seedB = await seedEvent(harness, { criteria: [["A", 100]], projects: ["P2"], judges: ["J2"], slug: "event-b" });
    const judgeA = await judgeClient(harness, seedA.judges[0]!.token);
    const res = await judgeA.put(`/api/judge/projects/${seedB.projectIds[0]}/draft`, {
      scores: {},
      expectedVersion: 0,
    });
    expect(res.status).toBe(404);
    expect(errorOf(res).code).toBe("not_found");
  });

  it("写请求跨站 Origin 被拒；同源 Origin 放行", async () => {
    const seed = await seedEvent(harness, { criteria: [["A", 100]], projects: ["P1"], judges: ["J1"] });
    const blocked = await harness.admin.request(
      "POST",
      `/api/admin/events/${seed.eventId}/start`,
      {},
      { Origin: "http://evil.example" },
    );
    expect(blocked.status).toBe(403);
    expect(errorOf(blocked).code).toBe("forbidden");

    const allowed = await harness.admin.request(
      "POST",
      `/api/admin/events/${seed.eventId}/start`,
      {},
      { Origin: "http://localhost:3200" },
    );
    expect(allowed.status).toBe(200);
  });
});
