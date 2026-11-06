// 当前管理员身份：模块级缓存，登录/登出时失效。路由守卫与 AdminLayout 共用同一次请求。
import { api } from "./api";

export interface AdminMe {
  id: string;
  username: string;
  name: string;
  role: "super" | "admin";
}

let cached: Promise<AdminMe> | null = null;

export function fetchMe(force = false): Promise<AdminMe> {
  if (!cached || force) {
    cached = api.get<AdminMe>("/admin/session").catch((error) => {
      cached = null;
      throw error;
    });
  }
  return cached;
}

export function invalidateMe(): void {
  cached = null;
}
