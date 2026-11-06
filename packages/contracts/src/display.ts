import { z } from "zod";

export const displaySessionRequest = z.object({
  token: z.string().min(20).max(200),
});

/**
 * 进度模式投影：不包含任何成绩、均分或排行字段（不是把完整数据发给浏览器后
 * 用 CSS 隐藏）。submittedCount 只针对当前项目。
 */
export interface ProgressSnapshotDto {
  revision: number;
  mode: "progress";
  eventName: string;
  status: "draft" | "judging" | "closed";
  currentProject: { position: number; name: string; teamName: string; summary?: string } | null;
  submittedCount: number;
  judgeCount: number;
}

export interface DisplayRowDto {
  projectId: string;
  position: number;
  rank: number | null;
  name: string;
  teamName: string;
  scoreText: string | null;
  submittedCount: number;
  judgeCount: number;
  complete: boolean;
}

export interface RankingSnapshotDto {
  revision: number;
  mode: "ranking";
  eventName: string;
  status: "draft" | "judging" | "closed";
  final: boolean;
  resultHash: string | null;
  judgeCount: number;
  rows: DisplayRowDto[];
}

export type DisplaySnapshotDto = ProgressSnapshotDto | RankingSnapshotDto;
