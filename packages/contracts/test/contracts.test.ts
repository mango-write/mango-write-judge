import { describe, expect, it } from "vitest";

import {
  closeEventRequest,
  createJudgeRequest,
  createProjectRequest,
  displayModeRequest,
  httpStatusOf,
  saveDraftRequest,
  submitScoresRequest,
} from "../src";

describe("请求契约", () => {
  it("评分草稿：分数必须是 0–100 整数十分位", () => {
    expect(saveDraftRequest.safeParse({ scores: { c1: 87 }, expectedVersion: 0 }).success).toBe(true);
    expect(saveDraftRequest.safeParse({ scores: { c1: 8.7 }, expectedVersion: 0 }).success).toBe(false);
    expect(saveDraftRequest.safeParse({ scores: { c1: 101 }, expectedVersion: 0 }).success).toBe(false);
    expect(saveDraftRequest.safeParse({ scores: { c1: -1 }, expectedVersion: 0 }).success).toBe(false);
  });

  it("正式提交要求合法 operationId", () => {
    const base = { scores: { c1: 50 }, expectedVersion: 0 };
    expect(submitScoresRequest.safeParse({ ...base, operationId: "op-123456" }).success).toBe(true);
    expect(submitScoresRequest.safeParse({ ...base, operationId: "短" }).success).toBe(false);
    expect(submitScoresRequest.safeParse({ ...base, operationId: "has space!" }).success).toBe(false);
  });

  it("项目/评委创建给文本字段提供默认值", () => {
    const project = createProjectRequest.parse({ name: "A", expectedRevision: 3 });
    expect(project).toMatchObject({ name: "A", teamName: "", summary: "", expectedRevision: 3 });
    expect(createJudgeRequest.parse({ name: "张三", expectedRevision: 3 }).name).toBe("张三");
  });

  it("切屏与闭幕的确认语义", () => {
    expect(displayModeRequest.parse({ mode: "ranking" }).confirmReveal).toBeUndefined();
    expect(displayModeRequest.parse({ mode: "ranking", confirmReveal: true }).confirmReveal).toBe(true);
    expect(closeEventRequest.safeParse({ confirm: true }).success).toBe(true);
    expect(closeEventRequest.safeParse({ confirm: false }).success).toBe(false);
  });

  it("错误码到 HTTP 状态的映射覆盖关键语义", () => {
    expect(httpStatusOf.evaluation_unlock_required).toBe(409);
    expect(httpStatusOf.reveal_confirm_required).toBe(428);
    expect(httpStatusOf.invalid_weights).toBe(422);
    expect(httpStatusOf.rate_limited).toBe(429);
    expect(httpStatusOf.incomplete_scores).toBe(422);
  });
});
