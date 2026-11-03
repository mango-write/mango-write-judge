// 测试用 HTTP 客户端：app.fetch 直连 + 单 cookie 跟随 + 错误信封断言辅助。
import type { Hono } from "hono";

import type { AppEnv } from "../routes/helpers";
import type { ErrorEnvelope } from "@mango-write-judge/contracts";

/* eslint-disable @typescript-eslint/no-explicit-any */
// 测试客户端：body 默认宽松类型，断言驱动结构
export interface ApiResponse<T = any> {
  status: number;
  body: T;
  cookies: string[];
  /** 原始字节：response.text() 的解码会剥 UTF-8 BOM，CSV 断言用这里。 */
  bytes: Uint8Array;
}

export class TestClient {
  private cookie = "";

  constructor(private readonly app: Hono<AppEnv>) {}

  setCookie(cookie: string): void {
    this.cookie = cookie;
  }

  get cookieHeader(): string {
    return this.cookie;
  }

  async request<T = any>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = { ...extraHeaders };
    if (this.cookie) headers.Cookie = `judge_session=${this.cookie}`;
    const isForm = typeof FormData !== "undefined" && body instanceof FormData;
    if (body !== undefined && !isForm && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    const response = await this.app.fetch(
      new Request(`http://localhost${path}`, {
        method,
        headers,
        body:
          body === undefined
            ? undefined
            : typeof body === "string" || isForm
              ? (body as RequestInit["body"])
              : JSON.stringify(body),
      }),
    );
    const setCookies = response.headers.getSetCookie?.() ?? [];
    for (const line of setCookies) {
      const [pair] = line.split(";");
      if (!pair) continue;
      const [name, value] = pair.split("=");
      if (name === "judge_session") this.cookie = value ?? "";
    }
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const text = new TextDecoder("utf-8").decode(buffer);
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    return { status: response.status, body: parsed as T, cookies: setCookies, bytes };
  }

  get<T = any>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>("GET", path);
  }

  post<T = any>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>("POST", path, body);
  }

  put<T = any>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>("PUT", path, body);
  }

  patch<T = any>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>("PATCH", path, body);
  }

  delete<T = any>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>("DELETE", path);
  }
}

export function errorOf(response: ApiResponse<unknown>): ErrorEnvelope["error"] {
  const body = response.body as { error?: ErrorEnvelope["error"] };
  return body?.error ?? { code: "internal_error", message: "no error envelope" };
}
