// 进程内滑动窗口限流（单实例口径）：管理登录按 IP，评分写按会话。
export interface RateLimiter {
  check(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterSec: number };
}

export function createRateLimiter(): RateLimiter {
  const hits = new Map<string, number[]>();

  function check(key: string, limit: number, windowMs: number) {
    const now = Date.now();
    const window = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (window.length >= limit) {
      const oldest = window[0]!;
      hits.set(key, window);
      return { allowed: false, retryAfterSec: Math.ceil((windowMs - (now - oldest)) / 1000) };
    }
    window.push(now);
    hits.set(key, window);
    if (hits.size > 10_000) {
      for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k);
    }
    return { allowed: true, retryAfterSec: 0 };
  }

  return { check };
}
