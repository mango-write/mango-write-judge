// 比赛与评分状态机的纯函数判定。状态迁移规则：
//   比赛 draft → judging → closed 单向；启动后规则/项目/评委名单冻结。
//   项目 unlocked 永久可评（直至闭幕）；当前项目可来回切换，已解锁不回锁。
//   首次公开排行写入 revealed_at 后永久生效：旧评分（version > 0）修改需有效解锁；
//   首次提交（version = 0）永不需要解锁。
import { checkWeights, type WeightsIssueCode } from "./scoring";

export type EventStatus = "draft" | "judging" | "closed";
export type DisplayMode = "progress" | "ranking";

export type StartIssueCode = WeightsIssueCode | "no_projects" | "no_judges";

export interface StartCheckInput {
  criteriaCount: number;
  projectsCount: number;
  judgesCount: number;
  weights: readonly number[];
}

export type StartCheck = { ok: true } | { ok: false; code: StartIssueCode };

export function checkCanStart(input: StartCheckInput): StartCheck {
  if (input.projectsCount < 1) return { ok: false, code: "no_projects" };
  if (input.judgesCount < 1) return { ok: false, code: "no_judges" };
  const weights = checkWeights(input.weights);
  return weights.ok ? { ok: true } : { ok: false, code: weights.code! };
}

export interface EvaluationRuleContext {
  eventStatus: EventStatus;
  projectUnlocked: boolean;
  revealed: boolean;
  /** 该评分的正式提交版本数；0 = 从未提交。 */
  submittedVersion: number;
  /** 当前存在有效解锁（已解锁、未撤销、未使用）。 */
  hasValidUnlock: boolean;
}

export interface EvaluationPermission {
  canSaveDraft: boolean;
  canSubmit: boolean;
  /** 只读的原因是「已公开排行且无有效解锁」；闭幕/未解锁的只读另行表达。 */
  lockedByReveal: boolean;
}

export function evaluationPermission(ctx: EvaluationRuleContext): EvaluationPermission {
  if (ctx.eventStatus !== "judging" || !ctx.projectUnlocked) {
    return { canSaveDraft: false, canSubmit: false, lockedByReveal: false };
  }
  if (ctx.submittedVersion === 0 || !ctx.revealed || ctx.hasValidUnlock) {
    return { canSaveDraft: true, canSubmit: true, lockedByReveal: false };
  }
  return { canSaveDraft: false, canSubmit: false, lockedByReveal: true };
}
