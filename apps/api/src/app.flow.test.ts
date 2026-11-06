import { beforeEach, describe, expect, it } from "vitest";

import { errorOf } from "./test-support/app";
import {
  createHarness,
  displayClient,
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

describe("建赛与启动冻结", () => {
  it("创建 → 配置 → 启动检查 → 启动；slug 冲突 409", async () => {
    const seed = await seedEvent(harness, {
      criteria: [["创新", 30], ["完成度", 30], ["表达", 40]],
      projects: ["项目一", "项目二", "项目三"],
      judges: ["评委甲", "评委乙"],
      slug: "demo-day",
    });
    const detail = await harness.admin.get(`/api/admin/events/${seed.eventId}`);
    expect(detail.body.weightsSum).toBe(100);
    expect(detail.body.startCheck.ok).toBe(true);
    expect(detail.body.displayInviteUrl).toContain("/display/demo-day#");
    expect(detail.body.judges[0].inviteUrl).toContain("/judge/demo-day#");

    const dup = await harness.admin.post("/api/admin/events", { name: "x", slug: "demo-day" });
    expect(dup.status).toBe(409);
    expect(errorOf(dup).code).toBe("slug_taken");

    const start = await harness.admin.post(`/api/admin/events/${seed.eventId}/start`);
    expect(start.status).toBe(200);

    // 启动后评分项与删除被冻结，但项目/评委名称微调与全部开放评分可用
    const frozen = await harness.admin.post(`/api/admin/events/${seed.eventId}/criteria`, {
      name: "新项",
      weightPercent: 10,
      expectedRevision: 99,
    });
    expect(frozen.status).toBe(409);
    expect(errorOf(frozen).code).toBe("event_not_draft");
    expect((await harness.admin.delete(`/api/admin/events/${seed.eventId}/projects/${seed.projectIds[0]}?expectedRevision=99`)).status).toBe(409);
    // 再次启动
    expect(errorOf(await harness.admin.post(`/api/admin/events/${seed.eventId}/start`)).code).toBe("event_not_draft");

    // 评审中可一键开放全部项目评分
    const unlockAll = await harness.admin.post(`/api/admin/events/${seed.eventId}/projects/unlock-all`);
    expect(unlockAll.status).toBe(200);
    const afterUnlockAll = await harness.admin.get(`/api/admin/events/${seed.eventId}`);
    expect(afterUnlockAll.body.projects.every((p: { unlockedAt: string | null }) => p.unlockedAt !== null)).toBe(true);
  });

  it("权重不合法不能启动（422 invalid_weights）", async () => {
    const seed = await seedEvent(harness, {
      criteria: [["A", 30], ["B", 30]],
      projects: ["P"],
      judges: ["J"],
    });
    const res = await harness.admin.post(`/api/admin/events/${seed.eventId}/start`);
    expect(res.status).toBe(422);
    expect(errorOf(res).code).toBe("invalid_weights");
  });

  it("expectedVersion 不匹配 → 409 revision_conflict", async () => {
    const seed = await seedEvent(harness, { criteria: [["A", 100]], projects: ["P"], judges: ["J"] });
    const res = await harness.admin.patch(`/api/admin/events/${seed.eventId}`, {
      name: "改名",
      expectedRevision: seed.revision + 5,
    });
    expect(res.status).toBe(409);
    expect(errorOf(res).code).toBe("revision_conflict");
  });

  it("CSV 导入项目与评委（multipart + 表头模式；缺 file 字段 400）", async () => {
    const created = await harness.admin.post<{ id: string }>("/api/admin/events", { name: "导入赛" });
    const eventId = created.body.id;
    const detail = await harness.admin.get<{ revision: number }>(`/api/admin/events/${eventId}`);
    const revision = detail.body.revision;

    const noFile = await harness.admin.request(
      "POST",
      `/api/admin/events/${eventId}/projects/import?expectedRevision=${revision}`,
      {},
    );
    expect(noFile.status).toBe(400);

    const projectsForm = new FormData();
    projectsForm.append(
      "file",
      new File(['项目,团队,简介\n"带,逗号",团队一,简介一\n项目乙,团队二,简介二\n'], "projects.csv", {
        type: "text/csv",
      }),
    );
    const importProjects = await harness.admin.request(
      "POST",
      `/api/admin/events/${eventId}/projects/import?expectedRevision=${revision}`,
      projectsForm,
    );
    expect(importProjects.status).toBe(200);
    expect(importProjects.body.created).toBe(2);

    const judgesForm = new FormData();
    judgesForm.append("file", new File(["姓名\n张三\n李四\n"], "judges.csv", { type: "text/csv" }));
    const importJudges = await harness.admin.request(
      "POST",
      `/api/admin/events/${eventId}/judges/import?expectedRevision=${revision + 1}`,
      judgesForm,
    );
    expect(importJudges.status).toBe(200);
    expect(importJudges.body.created).toBe(2);
    expect(importJudges.body.judges).toHaveLength(2);
    expect(importJudges.body.judges[0].inviteUrl).toContain("/judge/");
  });
});

describe("评分与展示—改分联动", () => {
  let seed: Seed;
  let judgeA: Awaited<ReturnType<typeof judgeClient>>;
  let judgeB: Awaited<ReturnType<typeof judgeClient>>;

  beforeEach(async () => {
    seed = await seedEvent(harness, {
      criteria: [["创新", 30], ["完成度", 30], ["表达", 40]],
      projects: ["甲", "乙", "丙"],
      judges: ["评委甲", "评委乙"],
    });
    await startEvent(harness, seed);
    judgeA = await judgeClient(harness, seed.judges[0]!.token);
    judgeB = await judgeClient(harness, seed.judges[1]!.token);
  });

  it("草稿保存不推进 revision；正式提交推进；进度大屏不含任何分数字段", async () => {
    await unlockProject(harness, seed, seed.projectIds[0]!);
    const before = (await judgeA.get("/api/judge/snapshot")).body.revision;
    const draft = await judgeA.put(`/api/judge/projects/${seed.projectIds[0]}/draft`, {
      scores: { [seed.criteriaIds[0]!]: 50 },
      expectedVersion: 0,
    });
    expect(draft.status).toBe(200);
    const afterDraft = (await judgeA.get("/api/judge/snapshot")).body.revision;
    expect(afterDraft).toBe(before);

    const display = await displayClient(harness, seed.displayToken);
    let progress = await display.get("/api/display/snapshot");
    expect(progress.body.mode).toBe("progress");
    expect(progress.body.submittedCount).toBe(0);
    expect(progress.body.currentProject.name).toBe("甲");

    const submitted = await judgeA.post(`/api/judge/projects/${seed.projectIds[0]}/submit`, {
      scores: fullScores(seed, 80),
      expectedVersion: 0,
      operationId: "op-judgeA-p0-v1",
    });
    expect(submitted.status).toBe(200);
    expect(submitted.body.version).toBe(1);

    progress = await display.get("/api/display/snapshot");
    expect(progress.body.submittedCount).toBe(1);
    const json = JSON.stringify(progress.body);
    for (const forbidden of ["score", "rank", "total", "milli", "centis", "items"]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it("未解锁项目不能评分；已解锁项目永久可评；当前项目可切换", async () => {
    const locked = await judgeA.put(`/api/judge/projects/${seed.projectIds[1]}/draft`, {
      scores: {},
      expectedVersion: 0,
    });
    expect(locked.status).toBe(403);

    await unlockProject(harness, seed, seed.projectIds[0]!);
    await unlockProject(harness, seed, seed.projectIds[1]!);
    await unlockProject(harness, seed, seed.projectIds[0]!); // 切回，不回锁
    const snapshot = await judgeA.get("/api/judge/snapshot");
    const project1 = snapshot.body.projects.find((p: { id: string }) => p.id === seed.projectIds[1])!;
    expect(project1.unlocked).toBe(true);
    expect(project1.active).toBe(false);
  });

  it("未公开排行前可自由改分；首次公开需确认；切回不恢复；改分需解锁", async () => {
    await unlockProject(harness, seed, seed.projectIds[0]!);
    await judgeA.post(`/api/judge/projects/${seed.projectIds[0]}/submit`, {
      scores: fullScores(seed, 80),
      expectedVersion: 0,
      operationId: "op-free-1",
    });
    // reveal 前自由改
    const edit = await judgeA.post(`/api/judge/projects/${seed.projectIds[0]}/submit`, {
      scores: fullScores(seed, 90),
      expectedVersion: 1,
      operationId: "op-free-2",
    });
    expect(edit.status).toBe(200);

    // 首次公开缺确认 → 428
    const noConfirm = await harness.admin.post(`/api/admin/events/${seed.eventId}/display-mode`, { mode: "ranking" });
    expect(noConfirm.status).toBe(428);
    expect(errorOf(noConfirm).code).toBe("reveal_confirm_required");

    const reveal = await harness.admin.post(`/api/admin/events/${seed.eventId}/display-mode`, {
      mode: "ranking",
      confirmReveal: true,
    });
    expect(reveal.status).toBe(200);
    expect(reveal.body.revealedAt).toBeTruthy();

    // 旧评分锁定
    const lockedEdit = await judgeA.put(`/api/judge/projects/${seed.projectIds[0]}/draft`, {
      scores: fullScores(seed, 70),
      expectedVersion: 2,
    });
    expect(lockedEdit.status).toBe(409);
    expect(errorOf(lockedEdit).code).toBe("evaluation_unlock_required");

    // 切回 progress 不恢复自由改分
    await harness.admin.post(`/api/admin/events/${seed.eventId}/display-mode`, { mode: "progress" });
    const still = await judgeA.post(`/api/judge/projects/${seed.projectIds[0]}/submit`, {
      scores: fullScores(seed, 70),
      expectedVersion: 2,
      operationId: "op-after-switch",
    });
    expect(errorOf(still).code).toBe("evaluation_unlock_required");

    // 公开后的首次提交不受解锁限制
    await judgeB.post(`/api/judge/projects/${seed.projectIds[0]}/submit`, {
      scores: fullScores(seed, 60),
      expectedVersion: 0,
      operationId: "op-judgeB-first",
    });
    const snapshotB = await judgeB.get("/api/judge/snapshot");
    const evalB = snapshotB.body.projects[0]!.evaluation;
    expect(evalB.submittedTotalText).toBe("6.00");
  });

  it("单次解锁：改交成功后自动重新锁定；排行按新版本更新", async () => {
    await unlockProject(harness, seed, seed.projectIds[0]!);
    await judgeA.post(`/api/judge/projects/${seed.projectIds[0]}/submit`, {
      scores: fullScores(seed, 80),
      expectedVersion: 0,
      operationId: "op-a-1",
    });
    await harness.admin.post(`/api/admin/events/${seed.eventId}/display-mode`, { mode: "ranking", confirmReveal: true });

    const matrix = await harness.admin.get(`/api/admin/events/${seed.eventId}/snapshot`);
    const cell = matrix.body.matrix[0]!.cells.find((c: { judgeId: string }) => c.judgeId === seed.judges[0]!.id)!;
    expect(cell.unlocked).toBe(false);

    const unlock = await harness.admin.post(
      `/api/admin/events/${seed.eventId}/evaluations/${cell.evaluationId}/unlock`,
    );
    expect(unlock.status).toBe(200);
    const snapshotA = await judgeA.get("/api/judge/snapshot");
    const unlockedEval = snapshotA.body.projects[0]!.evaluation;
    expect(unlockedEval.canSubmit).toBe(true);

    const resubmit = await judgeA.post(`/api/judge/projects/${seed.projectIds[0]}/submit`, {
      scores: fullScores(seed, 95),
      expectedVersion: 1,
      operationId: "op-a-2",
    });
    expect(resubmit.status).toBe(200);
    // 解锁已消费：再次修改被拒
    const again = await judgeA.post(`/api/judge/projects/${seed.projectIds[0]}/submit`, {
      scores: fullScores(seed, 50),
      expectedVersion: 2,
      operationId: "op-a-3",
    });
    expect(errorOf(again).code).toBe("evaluation_unlock_required");

    const display = await displayClient(harness, seed.displayToken);
    const ranking = await display.get("/api/display/snapshot");
    expect(ranking.body.mode).toBe("ranking");
    const row = ranking.body.rows.find((r: { projectId: string }) => r.projectId === seed.projectIds[0])!;
    // 9.50×1 人（评委乙未交）
    expect(row.scoreText).toBe("9.50");
  });

  it("撤销解锁：未提交的草稿不能正式提交，旧成绩保持", async () => {
    await unlockProject(harness, seed, seed.projectIds[0]!);
    await judgeA.post(`/api/judge/projects/${seed.projectIds[0]}/submit`, {
      scores: fullScores(seed, 80),
      expectedVersion: 0,
      operationId: "op-r-1",
    });
    await harness.admin.post(`/api/admin/events/${seed.eventId}/display-mode`, { mode: "ranking", confirmReveal: true });
    const snapshot = await harness.admin.get(`/api/admin/events/${seed.eventId}/snapshot`);
    const cell = snapshot.body.matrix[0]!.cells.find((c: { judgeId: string }) => c.judgeId === seed.judges[0]!.id)!;
    await harness.admin.post(`/api/admin/events/${seed.eventId}/evaluations/${cell.evaluationId}/unlock`);
    // 评委改了草稿但未提交
    await judgeA.put(`/api/judge/projects/${seed.projectIds[0]}/draft`, {
      scores: fullScores(seed, 10),
      expectedVersion: 1,
    });
    const revoke = await harness.admin.delete(
      `/api/admin/events/${seed.eventId}/evaluations/${cell.evaluationId}/unlock`,
    );
    expect(revoke.status).toBe(200);
    const rejected = await judgeA.post(`/api/judge/projects/${seed.projectIds[0]}/submit`, {
      scores: fullScores(seed, 10),
      expectedVersion: 1,
      operationId: "op-r-2",
    });
    expect(errorOf(rejected).code).toBe("evaluation_unlock_required");
    // 旧成绩保持
    const judgeSnapshot = await judgeA.get("/api/judge/snapshot");
    expect(judgeSnapshot.body.projects[0]!.evaluation.submittedTotalText).toBe("8.00");
  });

  it("幂等提交：同 operationId 重试返回同一响应；不同载荷 409；版本冲突 409", async () => {
    await unlockProject(harness, seed, seed.projectIds[0]!);
    const first = await judgeA.post(`/api/judge/projects/${seed.projectIds[0]}/submit`, {
      scores: fullScores(seed, 80),
      expectedVersion: 0,
      operationId: "op-idem",
    });
    expect(first.status).toBe(200);
    const retry = await judgeA.post(`/api/judge/projects/${seed.projectIds[0]}/submit`, {
      scores: fullScores(seed, 80),
      expectedVersion: 0,
      operationId: "op-idem",
    });
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual(first.body);

    const conflict = await judgeA.post(`/api/judge/projects/${seed.projectIds[0]}/submit`, {
      scores: fullScores(seed, 81),
      expectedVersion: 0,
      operationId: "op-idem",
    });
    expect(conflict.status).toBe(409);
    expect(errorOf(conflict).code).toBe("idempotency_conflict");

    const staleVersion = await judgeA.post(`/api/judge/projects/${seed.projectIds[0]}/submit`, {
      scores: fullScores(seed, 82),
      expectedVersion: 0,
      operationId: "op-idem-2",
    });
    expect(staleVersion.status).toBe(409);
    expect(errorOf(staleVersion).code).toBe("revision_conflict");

    const revisions = await harness.sql`SELECT count(*)::int AS n FROM evaluation_revisions`;
    expect(revisions[0]!.n).toBe(1);
  });

  it("不完整提交 422 并指出缺失评分项", async () => {
    await unlockProject(harness, seed, seed.projectIds[0]!);
    const res = await judgeA.post(`/api/judge/projects/${seed.projectIds[0]}/submit`, {
      scores: { [seed.criteriaIds[0]!]: 50 },
      expectedVersion: 0,
      operationId: "op-incomplete",
    });
    expect(res.status).toBe(422);
    expect(errorOf(res).code).toBe("incomplete_scores");
    expect((errorOf(res).details as { missing: string[] } | undefined)?.missing).toContain(seed.criteriaIds[1]);
  });
});

describe("闭幕与导出", () => {
  it("闭幕冻结一切；最终榜读快照；CSV 导出与快照一致；注入防护与 BOM", async () => {
    const seed = await seedEvent(harness, {
      criteria: [["创新", 30], ["完成度", 70]],
      projects: ["甲", "乙"],
      judges: ["=公式注入", "评委乙"],
    });
    await startEvent(harness, seed);
    await unlockProject(harness, seed, seed.projectIds[0]!);
    const judgeA = await judgeClient(harness, seed.judges[0]!.token);
    const judgeB = await judgeClient(harness, seed.judges[1]!.token);
    await judgeA.post(`/api/judge/projects/${seed.projectIds[0]}/submit`, {
      scores: { [seed.criteriaIds[0]!]: 100, [seed.criteriaIds[1]!]: 50 },
      expectedVersion: 0,
      operationId: "op-final-a",
    });
    await judgeB.post(`/api/judge/projects/${seed.projectIds[0]}/submit`, {
      scores: { [seed.criteriaIds[0]!]: 0, [seed.criteriaIds[1]!]: 100 },
      expectedVersion: 0,
      operationId: "op-final-b",
    });

    const close = await harness.admin.post(`/api/admin/events/${seed.eventId}/close`, { confirm: true });
    expect(close.status).toBe(200);
    expect(close.body.resultHash).toMatch(/^[0-9a-f]{64}$/);
    // 缺评：乙项目 0 提交
    expect(close.body.missing).toHaveLength(1);

    // 闭幕后再提交被拒
    await unlockProject(harness, seed, seed.projectIds[1]!).catch(() => undefined);
    const rejected = await judgeA.post(`/api/judge/projects/${seed.projectIds[1]}/submit`, {
      scores: { [seed.criteriaIds[0]!]: 10, [seed.criteriaIds[1]!]: 10 },
      expectedVersion: 0,
      operationId: "op-after-close",
    });
    expect(errorOf(rejected).code).toBe("event_closed");

    // 大屏等待揭晓 → 揭晓最终榜
    const display = await displayClient(harness, seed.displayToken);
    await harness.admin.post(`/api/admin/events/${seed.eventId}/display-mode`, { mode: "progress" });
    let progress = await display.get("/api/display/snapshot");
    expect(progress.body.status).toBe("closed");
    await harness.admin.post(`/api/admin/events/${seed.eventId}/display-mode`, { mode: "ranking", confirmReveal: true });
    const ranking = await display.get("/api/display/snapshot");
    expect(ranking.body.final).toBe(true);
    expect(ranking.body.resultHash).toBe(close.body.resultHash);
    const winner = ranking.body.rows.find((r: { projectId: string }) => r.projectId === seed.projectIds[0])!;
    // (10×30 + 5×70)/100 = 6.50；(0×30 + 10×70)/100 = 7.00 → 均 6.75
    expect(winner.scoreText).toBe("6.75");

    // 导出
    const resultsCsv = await harness.admin.get(`/api/admin/events/${seed.eventId}/export/results.csv`);
    expect(resultsCsv.status).toBe(200);
    expect(typeof resultsCsv.body === "string" ? resultsCsv.body : "").not.toBe("");
    const resultsText = String(resultsCsv.body);
    expect([...resultsCsv.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM
    expect(resultsText).toContain("rank,project_order,project_name,team_name,score,submitted_judges,total_judges,is_complete,result_status");
    expect(resultsText).toContain("final");
    expect(resultsText).toContain("6.75");

    const scoresCsv = await harness.admin.get(`/api/admin/events/${seed.eventId}/export/scores.csv`);
    const scoresText = String(scoresCsv.body);
    expect(scoresText).toContain("创新(30%)");
    expect(scoresText).toContain("'=公式注入"); // 公式注入防护
    expect(scoresText).toContain("7.00");
    expect(scoresText).toContain("missing"); // 未评项目行
  });
});
