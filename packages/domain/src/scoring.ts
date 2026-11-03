// 唯一计分口径：分数一律整数「十分位」（8.7 → 87），评委总分用整数「毫位」
// （千分之一分）精确求和，项目得分 half-up 保留两位小数（整数「百分位」）。
// 实时总榜、管理端结果、最终快照与 CSV 导出都经本模块，任何面不得另写公式。

export const MAX_CRITERIA = 20;
export const MIN_WEIGHT_PERCENT = 1;
export const MAX_WEIGHT_PERCENT = 100;
export const TARGET_WEIGHT_SUM = 100;

/** 结果快照记录算法版本；口径变更（权重语义、舍入规则）必须递增。 */
export const ALGORITHM_VERSION = "1";

export type WeightsIssueCode =
  | "no_criteria"
  | "too_many_criteria"
  | "weight_out_of_range"
  | "weight_sum_mismatch";

export interface WeightsCheck {
  ok: boolean;
  code?: WeightsIssueCode;
  sum: number;
}

export function checkWeights(weights: readonly number[]): WeightsCheck {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return { ok: false, code: "no_criteria", sum: 0 };
  if (weights.length > MAX_CRITERIA) return { ok: false, code: "too_many_criteria", sum };
  if (
    weights.some(
      (w) => !Number.isInteger(w) || w < MIN_WEIGHT_PERCENT || w > MAX_WEIGHT_PERCENT,
    )
  ) {
    return { ok: false, code: "weight_out_of_range", sum };
  }
  if (sum !== TARGET_WEIGHT_SUM) return { ok: false, code: "weight_sum_mismatch", sum };
  return { ok: true, sum };
}

export interface CriterionWeight {
  id: string;
  weightPercent: number;
}

/**
 * 评委总分（毫位）= Σ(score_tenths × weightPercent)，权重合计恒为 100，
 * 结果上界 100 × 100 = 10.000 分。任一评分项缺分或越界返回 null。
 */
export function judgeTotalMilli(
  scores: ReadonlyMap<string, number>,
  criteria: readonly CriterionWeight[],
): number | null {
  let total = 0;
  for (const criterion of criteria) {
    const value = scores.get(criterion.id);
    if (value === undefined || !Number.isInteger(value) || value < 0 || value > 100) {
      return null;
    }
    total += value * criterion.weightPercent;
  }
  return total;
}

/**
 * 项目得分（百分位整数，即两位小数）：
 * roundHalfUp(Σ评委总分毫位 ÷ 已提交评委数 ÷ 10)。分母是已提交人数，不是评委总数。
 */
export function projectScoreCentis(totalMilliSum: number, submittedCount: number): number {
  if (!Number.isInteger(totalMilliSum) || totalMilliSum < 0 || submittedCount <= 0) {
    throw new Error("projectScoreCentis requires non-negative integer sum and positive count");
  }
  // half-up 的 .5 判定在整数域完成：加半个分母后向下取整（10n 恒为偶数，无精度损失）。
  return Math.floor((totalMilliSum + 5 * submittedCount) / (10 * submittedCount));
}

/** 百分位整数 → 两位小数字符串（排名展示与 CSV 共用，保证「看到的分数」一致）。 */
export function formatCentis(centis: number): string {
  const whole = Math.trunc(centis / 100);
  const frac = Math.abs(centis % 100);
  return `${whole}.${String(frac).padStart(2, "0")}`;
}

/** 毫位 → 两位小数展示（half-up）。用于评委总分展示；聚合计算仍用原始毫位。 */
export function formatMilli2(milli: number): string {
  return formatCentis(Math.floor((milli + 5) / 10));
}
