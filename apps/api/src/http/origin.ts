import type { MiddlewareHandler } from "hono";

import { forbidden } from "./errors";

/**
 * 写请求 Origin 校验：浏览器发起的跨站写（Origin 与目标 Host 不一致）直接 403。
 * 无 Origin 的非浏览器客户端放行；本服务不开放任何跨域 CORS。
 */
export function originGuard(publicBaseUrl: string): MiddlewareHandler {
  const allowedHosts = new Set<string>();
  try {
    allowedHosts.add(new URL(publicBaseUrl).host);
  } catch {
    // PUBLIC_BASE_URL 非法时不放行任何额外 host
  }
  return async (c, next) => {
    if (c.req.method === "GET" || c.req.method === "HEAD" || c.req.method === "OPTIONS") {
      return next();
    }
    const origin = c.req.header("Origin");
    if (!origin) return next();
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw forbidden("非法 Origin");
    }
    const host = c.req.header("Host") ?? "";
    if (originHost !== host && !allowedHosts.has(originHost)) {
      throw forbidden("跨站写入被拒绝");
    }
    return next();
  };
}
