import { beforeEach, describe, expect, it } from "vitest";

import { errorOf } from "./test-support/app";
import {
  createHarness,
  judgeClient,
  seedEvent,
  startEvent,
  unlockProject,
  type Harness,
  type Seed,
} from "./test-support/harness";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

function fullScores(seed: Seed, value: number): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const id of seed.criteriaIds) scores[id] = value;
  return scores;
}

describe("并发与竞争", () => {
  it("同一评分并发提交：恰有一个成功，版本快照只有一份", async () => {
    const seed = await seedEvent(harness, {
      criteria: [["A", 50], ["B", 50]],
      projects: ["P"],
      judges: ["J"],
    });
    await startEvent(harness, seed);
    await unlockProject(harness, seed, seed.projectIds[0]!);
    const judge = await judgeClient(harness, seed.judges[0]!.token);
    const projectId = seed.projectIds[0]!;

    const [first, second] = await Promise.all([
      judge.post(`/api/judge/projects/${projectId}/submit`, {
        scores: fullScores(seed, 80),
        expectedVersion: 0,
        operationId: "concurrent-1",
      }),
      judge.post(`/api/judge/projects/${projectId}/submit`, {
        scores: fullScores(seed, 90),
        expectedVersion: 0,
        operationId: "concurrent-2",
      }),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = first.status === 409 ? first : second;
    expect(errorOf(loser).code).toBe("revision_conflict");
    const revisions = await harness.sql`SELECT count(*)::int AS n FROM evaluation_revisions`;
    expect(revisions[0]!.n).toBe(1);
  });

  it("闭幕与提交竞争：先提交后闭幕则计入快照；先闭幕则提交被拒", async () => {
    const seed = await seedEvent(harness, {
      criteria: [["A", 100]],
      projects: ["P"],
      judges: ["J", "K"],
    });
    await startEvent(harness, seed);
    await unlockProject(harness, seed, seed.projectIds[0]!);
    const judge = await judgeClient(harness, seed.judges[0]!.token);

    const [, close] = await Promise.all([
      judge.post(`/api/judge/projects/${seed.projectIds[0]}/submit`, {
        scores: fullScores(seed, 70),
        expectedVersion: 0,
        operationId: "race-1",
      }),
      harness.admin.post(`/api/admin/events/${seed.eventId}/close`, { confirm: true }),
    ]);
    expect(close.status).toBe(200);
    // 无论先后，最终态一致：已闭幕 + 快照存在
    const snapshot = await harness.sql`SELECT result_hash FROM result_snapshots WHERE event_id = ${seed.eventId}`;
    expect(snapshot).toHaveLength(1);
    const event = await harness.sql<{ status: string }[]>`SELECT status FROM events WHERE id = ${seed.eventId}`;
    expect(event[0]!.status).toBe("closed");

    const late = await judge.post(`/api/judge/projects/${seed.projectIds[0]}/submit`, {
      scores: fullScores(seed, 10),
      expectedVersion: 0,
      operationId: "race-late",
    });
    expect(errorOf(late).code).toBe("event_closed");
  });

  it("重启语义：会话/评分/结果在数据库中持久（进程内重建 app 后仍可用）", async () => {
    const seed = await seedEvent(harness, {
      criteria: [["A", 100]],
      projects: ["P"],
      judges: ["J"],
    });
    await startEvent(harness, seed);
    await unlockProject(harness, seed, seed.projectIds[0]!);
    const judge = await judgeClient(harness, seed.judges[0]!.token);
    await judge.post(`/api/judge/projects/${seed.projectIds[0]}/submit`, {
      scores: fullScores(seed, 60),
      expectedVersion: 0,
      operationId: "persist-1",
    });
    await harness.admin.post(`/api/admin/events/${seed.eventId}/close`, { confirm: true });

    // 模拟 API 重启：同一数据库重建应用（会话在库中，cookie 仍有效）
    const { createHarness: recreate } = await import("./test-support/harness");
    const reborn = await recreate(false);
    const adminList = await reborn.admin.get("/api/admin/events");
    expect(adminList.status).toBe(200);
    expect(JSON.stringify(adminList.body)).toContain(seed.eventId);

    const judgeAgain = await judgeClient(reborn, seed.judges[0]!.token);
    const snapshot = await judgeAgain.get("/api/judge/snapshot");
    expect(snapshot.body.projects[0]!.evaluation.submittedTotalText).toBe("6.00");
    expect(snapshot.body.projects[0]!.evaluation.canSubmit).toBe(false);
  });
});
