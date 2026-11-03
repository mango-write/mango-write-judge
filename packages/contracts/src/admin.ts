import { z } from "zod";

import {
  displayModeSchema,
  eventStatusSchema,
  expectedRevisionSchema,
  idSchema,
  slugSchema,
  type CriterionDto,
  type ProjectDto,
  type ResultsDto,
} from "./common";

// ---------- 请求 ----------

export const adminLoginRequest = z.object({
  password: z.string().min(1).max(1024),
});

export const createEventRequest = z.object({
  name: z.string().trim().min(1).max(200),
  slug: slugSchema.optional(),
  description: z.string().max(1000).default(""),
});

export const patchEventRequest = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  expectedRevision: expectedRevisionSchema,
});

export const createCriterionRequest = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(1000).default(""),
  weightPercent: z.number().int().min(1).max(100),
  expectedRevision: expectedRevisionSchema,
});

export const patchCriterionRequest = createCriterionRequest.partial().extend({
  expectedRevision: expectedRevisionSchema,
});

export const createProjectRequest = z.object({
  name: z.string().trim().min(1).max(200),
  teamName: z.string().max(200).default(""),
  summary: z.string().max(2000).default(""),
  expectedRevision: expectedRevisionSchema,
});

export const patchProjectRequest = createProjectRequest.partial().extend({
  expectedRevision: expectedRevisionSchema,
});

export const createJudgeRequest = z.object({
  name: z.string().trim().min(1).max(200),
  expectedRevision: expectedRevisionSchema,
});

export const patchJudgeRequest = createJudgeRequest.partial().extend({
  expectedRevision: expectedRevisionSchema,
});

export const reorderRequest = z.object({
  ids: z.array(idSchema).min(1).max(250),
  expectedRevision: expectedRevisionSchema,
});

export const activeProjectRequest = z.object({
  projectId: idSchema,
});

export const displayModeRequest = z.object({
  mode: displayModeSchema,
  /** 首次切换到 ranking 必须显式确认；缺省视为未确认。 */
  confirmReveal: z.boolean().optional(),
});

export const closeEventRequest = z.object({
  confirm: z.literal(true),
});

// ---------- 响应 ----------

export interface EventSummaryDto {
  id: string;
  slug: string;
  name: string;
  status: z.infer<typeof eventStatusSchema>;
  criterionCount: number;
  projectCount: number;
  judgeCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface JudgeDto {
  id: string;
  name: string;
  createdAt: string;
}

/** 评委邀请：token 只在创建/轮换/导入时返回一次。单个创建/轮换附带新 revision。 */
export interface JudgeInviteDto {
  id: string;
  name: string;
  inviteUrl: string;
  revision?: number;
}

export interface CsvImportJudgeRow {
  name: string;
}

export interface StartCheckDto {
  ok: boolean;
  code: string | null;
  criterionCount: number;
  projectCount: number;
  judgeCount: number;
  weightsSum: number;
  displayLinkReady: boolean;
}

export interface EventDetailDto {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: z.infer<typeof eventStatusSchema>;
  revision: number;
  displayMode: z.infer<typeof displayModeSchema>;
  revealedAt: string | null;
  closedAt: string | null;
  activeProjectId: string | null;
  criteria: CriterionDto[];
  projects: ProjectDto[];
  judges: JudgeDto[];
  weightsSum: number;
  startCheck: StartCheckDto;
  createdAt: string;
  updatedAt: string;
}

export type MatrixCellStatus = "none" | "draft" | "submitted";

export interface MatrixCellDto {
  judgeId: string;
  evaluationId: string | null;
  status: MatrixCellStatus;
  version: number;
  submittedAt: string | null;
  /** 当前存在有效解锁（未撤销、未使用）。 */
  unlocked: boolean;
  /** 该评委最近正式提交的各评分项得分（十分位）；未提交为 null。 */
  submittedItems: Record<string, number> | null;
  /** 评委最近正式提交的总分（两位小数文本）；未提交为 null。 */
  submittedTotalText: string | null;
}

export interface MatrixRowDto {
  projectId: string;
  cells: MatrixCellDto[];
}

export interface AdminSnapshotDto {
  event: EventDetailDto;
  matrix: MatrixRowDto[];
  results: ResultsDto | null;
  revision: number;
}

export interface CsvImportResultDto {
  created: number;
  errors: { row: number; message: string }[];
  judges?: JudgeInviteDto[];
}

export interface DisplayInviteDto {
  inviteUrl: string;
}
