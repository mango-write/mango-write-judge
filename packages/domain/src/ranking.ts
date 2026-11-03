// 竞赛排名：按项目得分降序、同分并列（1、1、3），并列内部按赛前项目顺序稳定
// 排列；无有效提交的项目排在有成绩项目之后，不参与名次编号。
import { ALGORITHM_VERSION, formatCentis, projectScoreCentis } from "./scoring";

export interface ProjectScoreInput {
  projectId: string;
  position: number;
  judgeCount: number;
  submittedCount: number;
  /** 已提交评委总分（毫位）之和；无有效提交时为 null。 */
  totalMilliSum: number | null;
}

export interface ProjectResultRow {
  projectId: string;
  position: number;
  rank: number | null;
  scoreCentis: number | null;
  scoreText: string | null;
  submittedCount: number;
  judgeCount: number;
  complete: boolean;
}

export interface EventResults {
  algorithmVersion: string;
  judgeCount: number;
  rows: ProjectResultRow[];
}

export function computeEventResults(
  judgeCount: number,
  projects: readonly ProjectScoreInput[],
): EventResults {
  const rows: ProjectResultRow[] = projects.map((project) => {
    const hasScore =
      project.totalMilliSum !== null &&
      Number.isInteger(project.totalMilliSum) &&
      project.totalMilliSum >= 0 &&
      project.submittedCount > 0;
    const centis = hasScore
      ? projectScoreCentis(project.totalMilliSum as number, project.submittedCount)
      : null;
    return {
      projectId: project.projectId,
      position: project.position,
      rank: null,
      scoreCentis: centis,
      scoreText: centis === null ? null : formatCentis(centis),
      submittedCount: project.submittedCount,
      judgeCount,
      complete: project.submittedCount >= judgeCount,
    };
  });

  const byPosition = (a: ProjectResultRow, b: ProjectResultRow) => a.position - b.position;
  const scored = rows.filter((r) => r.scoreCentis !== null).sort((a, b) => b.scoreCentis! - a.scoreCentis! || byPosition(a, b));
  const unscored = rows.filter((r) => r.scoreCentis === null).sort(byPosition);

  let previousScore: number | null = null;
  let previousRank = 0;
  scored.forEach((row, index) => {
    if (previousScore !== null && row.scoreCentis === previousScore) {
      row.rank = previousRank;
    } else {
      row.rank = index + 1;
      previousRank = index + 1;
      previousScore = row.scoreCentis;
    }
  });

  return { algorithmVersion: ALGORITHM_VERSION, judgeCount, rows: [...scored, ...unscored] };
}
