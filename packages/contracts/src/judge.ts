import { z } from "zod";

import {
  evaluationStatusSchema,
  expectedVersionSchema,
  idSchema,
  scoreTenthsSchema,
  type CriterionDto,
} from "./common";

// ---------- 请求 ----------

/** 链接 fragment 中的 token 换 HttpOnly 会话。 */
export const judgeSessionRequest = z.object({
  token: z.string().min(20).max(200),
});

export const saveDraftRequest = z.object({
  /** 全量草稿：各评分项得分（十分位）。键必须是该比赛当前生效的评分项。 */
  scores: z.record(idSchema, scoreTenthsSchema),
  expectedVersion: expectedVersionSchema,
});

export const submitScoresRequest = saveDraftRequest.extend({
  /** 每次提交意图一个新值；网络重试复用同一值。 */
  operationId: z.string().min(6).max(64).regex(/^[A-Za-z0-9_-]+$/),
});

// ---------- 响应 ----------

export interface JudgeEvaluationDto {
  status: z.infer<typeof evaluationStatusSchema>;
  version: number;
  canSaveDraft: boolean;
  canSubmit: boolean;
  lockedByReveal: boolean;
  /** 当前工作副本（草稿或最近正式提交的值）。 */
  items: Record<string, number>;
  submittedAt: string | null;
  submittedTotalText: string | null;
}

export interface JudgeProjectDto {
  id: string;
  name: string;
  teamName: string;
  summary: string;
  position: number;
  unlocked: boolean;
  active: boolean;
  evaluation: JudgeEvaluationDto | null;
}

export interface JudgeSnapshotDto {
  event: {
    name: string;
    slug: string;
    status: "draft" | "judging" | "closed";
  };
  judge: { id: string; name: string };
  criteria: CriterionDto[];
  projects: JudgeProjectDto[];
  revision: number;
}

export interface SubmitScoresResponseDto {
  version: number;
  submittedAt: string;
  revision: number;
}
