import { describe, expect, it } from "vitest";

import { checkCanStart, evaluationPermission, type StartCheck } from "../src";

const codeOf = (result: StartCheck) => (result.ok ? undefined : result.code);

describe("checkCanStart", () => {
  it("齐备且权重合法才可启动", () => {
    expect(checkCanStart({ criteriaCount: 3, projectsCount: 1, judgesCount: 1, weights: [30, 30, 40] })).toEqual({ ok: true });
  });

  it("缺项目、缺评委、权重不合法分别拒绝", () => {
    expect(codeOf(checkCanStart({ criteriaCount: 1, projectsCount: 0, judgesCount: 1, weights: [100] }))).toBe("no_projects");
    expect(codeOf(checkCanStart({ criteriaCount: 1, projectsCount: 1, judgesCount: 0, weights: [100] }))).toBe("no_judges");
    expect(codeOf(checkCanStart({ criteriaCount: 2, projectsCount: 1, judgesCount: 1, weights: [50, 40] }))).toBe("weight_sum_mismatch");
  });
});

describe("evaluationPermission（展示—改分联动）", () => {
  it("首次提交永不需要解锁：只要比赛评审中且项目已解锁", () => {
    const p = evaluationPermission({
      eventStatus: "judging",
      projectUnlocked: true,
      revealed: true,
      submittedVersion: 0,
      hasValidUnlock: false,
    });
    expect(p).toEqual({ canSaveDraft: true, canSubmit: true, lockedByReveal: false });
  });

  it("未公开排行前已提交的评分可自由修改", () => {
    const p = evaluationPermission({
      eventStatus: "judging",
      projectUnlocked: true,
      revealed: false,
      submittedVersion: 2,
      hasValidUnlock: false,
    });
    expect(p).toEqual({ canSaveDraft: true, canSubmit: true, lockedByReveal: false });
  });

  it("公开排行后旧评分默认只读，须管理员解锁", () => {
    const p = evaluationPermission({
      eventStatus: "judging",
      projectUnlocked: true,
      revealed: true,
      submittedVersion: 1,
      hasValidUnlock: false,
    });
    expect(p).toEqual({ canSaveDraft: false, canSubmit: false, lockedByReveal: true });
  });

  it("有效解锁恢复编辑权限", () => {
    const p = evaluationPermission({
      eventStatus: "judging",
      projectUnlocked: true,
      revealed: true,
      submittedVersion: 1,
      hasValidUnlock: true,
    });
    expect(p.canSaveDraft).toBe(true);
    expect(p.canSubmit).toBe(true);
  });

  it("未解锁项目与闭幕比赛一律只读", () => {
    expect(
      evaluationPermission({ eventStatus: "judging", projectUnlocked: false, revealed: false, submittedVersion: 0, hasValidUnlock: false }).canSubmit,
    ).toBe(false);
    expect(
      evaluationPermission({ eventStatus: "closed", projectUnlocked: true, revealed: true, submittedVersion: 1, hasValidUnlock: true }).canSubmit,
    ).toBe(false);
  });

  it("草稿期不可评分", () => {
    expect(
      evaluationPermission({ eventStatus: "draft", projectUnlocked: false, revealed: false, submittedVersion: 0, hasValidUnlock: false }).canSaveDraft,
    ).toBe(false);
  });
});
