import { z } from "zod";

export const idSchema = z.string().min(1).max(64);
export const slugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/, "slug 只允许小写字母、数字与中划线");
/** 评分值：整数十分位（8.7 → 87）。 */
export const scoreTenthsSchema = z.number().int().min(0).max(100);
export const expectedVersionSchema = z.number().int().min(0);
export const expectedRevisionSchema = z.number().int().min(0);

export const eventStatusSchema = z.enum(["draft", "judging", "closed"]);
export const displayModeSchema = z.enum(["progress", "ranking"]);
export const evaluationStatusSchema = z.enum(["draft", "submitted"]);

/** SSE 事件载荷：只发 revision，客户端收到更高值后重拉自己的角色快照。 */
export const revisionEventSchema = z.object({ revision: z.number().int().nonnegative() });
export type RevisionEvent = z.infer<typeof revisionEventSchema>;

export interface CriterionDto {
  id: string;
  name: string;
  description: string;
  weightPercent: number;
  position: number;
}

export interface ProjectDto {
  id: string;
  name: string;
  teamName: string;
  summary: string;
  position: number;
  unlockedAt: string | null;
  active: boolean;
}

export interface ResultRowDto {
  projectId: string;
  position: number;
  rank: number | null;
  scoreText: string | null;
  submittedCount: number;
  judgeCount: number;
  complete: boolean;
}

export interface ResultsDto {
  algorithmVersion: string;
  judgeCount: number;
  rows: ResultRowDto[];
  /** 闭幕冻结后的结果为最终版，携带结果哈希与闭幕时间。 */
  final: boolean;
  resultHash: string | null;
  closedAt: string | null;
}
