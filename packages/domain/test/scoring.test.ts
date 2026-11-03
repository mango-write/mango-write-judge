import { describe, expect, it } from "vitest";

import {
  checkWeights,
  formatCentis,
  formatMilli2,
  judgeTotalMilli,
  projectScoreCentis,
} from "../src";

describe("checkWeights", () => {
  it("通过合法权重", () => {
    expect(checkWeights([30, 30, 40])).toEqual({ ok: true, sum: 100 });
    expect(checkWeights([100])).toEqual({ ok: true, sum: 100 });
    expect(checkWeights(Array<number>(20).fill(5))).toEqual({ ok: true, sum: 100 });
  });

  it("拒绝空、超量、越界、和不为 100", () => {
    expect(checkWeights([]).code).toBe("no_criteria");
    expect(checkWeights(Array<number>(21).fill(5)).code).toBe("too_many_criteria");
    expect(checkWeights([0, 100]).code).toBe("weight_out_of_range");
    expect(checkWeights([101, -1]).code).toBe("weight_out_of_range");
    expect(checkWeights([30.5, 69.5]).code).toBe("weight_out_of_range");
    expect(checkWeights([30, 30, 30]).code).toBe("weight_sum_mismatch");
  });
});

describe("judgeTotalMilli", () => {
  const criteria = [
    { id: "a", weightPercent: 30 },
    { id: "b", weightPercent: 70 },
  ];

  it("整数毫位精确求和（8.7×30% = 2.61 → 2610 毫位）", () => {
    expect(judgeTotalMilli(new Map([["a", 87], ["b", 0]]), criteria)).toBe(87 * 30);
  });

  it("全 0 分是有效总分 0", () => {
    expect(judgeTotalMilli(new Map([["a", 0], ["b", 0]]), criteria)).toBe(0);
  });

  it("满分 10 分", () => {
    expect(judgeTotalMilli(new Map([["a", 100], ["b", 100]]), criteria)).toBe(10000);
  });

  it("任一评分项缺分返回 null（草稿不完整不得计分）", () => {
    expect(judgeTotalMilli(new Map([["a", 50]]), criteria)).toBeNull();
    expect(judgeTotalMilli(new Map(), criteria)).toBeNull();
  });

  it("越界分数返回 null", () => {
    expect(judgeTotalMilli(new Map([["a", 101], ["b", 50]]), criteria)).toBeNull();
    expect(judgeTotalMilli(new Map([["a", -1], ["b", 50]]), criteria)).toBeNull();
    expect(judgeTotalMilli(new Map([["a", 5.5], ["b", 50]]), criteria)).toBeNull();
  });
});

describe("projectScoreCentis（half-up 两位小数）", () => {
  it("均值恰为 .5 时进位：0.875 → 0.88", () => {
    expect(projectScoreCentis(875, 1)).toBe(88);
    expect(projectScoreCentis(875 + 875, 2)).toBe(88);
    expect(projectScoreCentis(873 + 877, 2)).toBe(88);
  });

  it("均值低于 .5 时舍去：0.8749 → 0.87", () => {
    expect(projectScoreCentis(874, 1)).toBe(87);
    expect(projectScoreCentis(874 + 874, 2)).toBe(87);
  });

  it("无小数与多位小数场景", () => {
    expect(projectScoreCentis(8000 + 8000, 2)).toBe(800); // (8.000 + 8.000) / 2 = 8.00
    expect(projectScoreCentis(2871 + 2871 + 2871, 3)).toBe(287); // 2.871 → 2.87
    expect(projectScoreCentis(0, 5)).toBe(0); // 全 0 分仍参与排名
  });

  it("非法输入抛错", () => {
    expect(() => projectScoreCentis(100, 0)).toThrow();
    expect(() => projectScoreCentis(-1, 1)).toThrow();
  });
});

describe("格式化", () => {
  it("百分位整数转两位小数字符串", () => {
    expect(formatCentis(0)).toBe("0.00");
    expect(formatCentis(5)).toBe("0.05");
    expect(formatCentis(288)).toBe("2.88");
    expect(formatCentis(1000)).toBe("10.00");
  });

  it("毫位 half-up 到两位小数展示", () => {
    expect(formatMilli2(2871)).toBe("2.87");
    expect(formatMilli2(2875)).toBe("2.88");
    expect(formatMilli2(0)).toBe("0.00");
  });
});
