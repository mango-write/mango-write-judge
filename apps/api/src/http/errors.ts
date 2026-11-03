import type { ContentfulStatusCode } from "hono/utils/http-status";

import { httpStatusOf, type ErrorCode } from "@mango-write-judge/contracts";

/** 业务错误：路由/服务统一抛出，app.onError 折成统一错误信封。 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }

  get status(): ContentfulStatusCode {
    return httpStatusOf[this.code] as ContentfulStatusCode;
  }
}

export const notFound = (message = "资源不存在") => new AppError("not_found", message);
export const unauthorized = (message = "未登录或会话已失效") => new AppError("unauthorized", message);
export const forbidden = (message = "无权访问") => new AppError("forbidden", message);
