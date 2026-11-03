import { describe, expect, it } from "vitest";

import { computeEventResults, type ProjectScoreInput } from "../src";

const base = { judgeCount: 3 };

function row(over: Partial<ProjectScoreInput> & { projectId: string }): ProjectScoreInput {
  return { position: 1, judgeCount: base.judgeCount, submittedCount: 0, totalMilliSum: null, ...over };
}

describe("computeEventResults", () => {
  it("按分数降序，同分并列 1、1、3", () => {
    // totalMilliSum 是三位评委的总和：28500/3 = 9.50，27000/3 = 9.00
    const results = computeEventResults(3, [
      row({ projectId: "p1", position: 1, submittedCount: 3, totalMilliSum: 28500 }),
      row({ projectId: "p2", position: 2, submittedCount: 3, totalMilliSum: 28500 }),
      row({ projectId: "p3", position: 3, submittedCount: 3, totalMilliSum: 27000 }),
    ]);
    expect(results.rows.map((r) => [r.projectId, r.rank, r.scoreText])).toEqual([
      ["p1", 1, "9.50"],
      ["p2", 1, "9.50"],
      ["p3", 3, "9.00"],
    ]);
  });

  it("并列内部按赛前顺序稳定排列", () => {
    const results = computeEventResults(1, [
      row({ projectId: "late", position: 5, submittedCount: 1, totalMilliSum: 5000 }),
      row({ projectId: "early", position: 2, submittedCount: 1, totalMilliSum: 5000 }),
    ]);
    expect(results.rows.map((r) => r.projectId)).toEqual(["early", "late"]);
    expect(results.rows.map((r) => r.rank)).toEqual([1, 1]);
  });

  it("无成绩项目排最后且不占名次编号", () => {
    const results = computeEventResults(2, [
      row({ projectId: "none", position: 1 }),
      row({ projectId: "scored", position: 2, submittedCount: 1, totalMilliSum: 4000 }),
    ]);
    expect(results.rows.map((r) => [r.projectId, r.rank, r.scoreText])).toEqual([
      ["scored", 1, "4.00"],
      ["none", null, null],
    ]);
  });

  it("缺评不影响已有成绩，complete 标记缺评", () => {
    const results = computeEventResults(3, [
      row({ projectId: "p", position: 1, submittedCount: 2, totalMilliSum: 8000 + 9000 }),
    ]);
    expect(results.rows[0]).toMatchObject({ submittedCount: 2, complete: false, scoreText: "8.50" });
  });

  it("排名依据是保留两位小数后的得分（看到的分数即排名依据）", () => {
    // 两项目精确均值差 0.001（毫位），两位小数后同分 → 并列。
    const results = computeEventResults(1, [
      row({ projectId: "hi", position: 2, submittedCount: 1, totalMilliSum: 8751 }),
      row({ projectId: "lo", position: 1, submittedCount: 1, totalMilliSum: 8750 }),
    ]);
    expect(results.rows.map((r) => [r.projectId, r.rank, r.scoreText])).toEqual([
      ["lo", 1, "8.75"],
      ["hi", 1, "8.75"],
    ]);
  });

  it("携带算法版本与评委数", () => {
    const results = computeEventResults(7, []);
    expect(results.algorithmVersion).toBe("1");
    expect(results.judgeCount).toBe(7);
    expect(results.rows).toEqual([]);
  });
});
