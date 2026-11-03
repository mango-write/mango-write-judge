// 运行配置：全部来自环境变量；生产（PUBLIC_BASE_URL 为 https）强制 Secure cookie。
export interface AppConfig {
  databaseUrl: string;
  adminPassword: string;
  publicBaseUrl: string;
  inviteBaseUrl: string;
  port: number;
  secureCookies: boolean;
  /** web 构建产物目录；不存在时跳过静态托管（纯 API 模式）。 */
  webDistDir: string | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = env.DATABASE_URL;
  const adminPassword = env.ADMIN_PASSWORD ?? "";
  if (!databaseUrl) throw new Error("缺少环境变量 DATABASE_URL（见 .env.example）");
  if (adminPassword.length < 12) {
    throw new Error("ADMIN_PASSWORD 至少 12 位且不提供默认值（openssl rand -base64 24）");
  }
  const publicBaseUrl = (env.PUBLIC_BASE_URL ?? "http://localhost:3200").replace(/\/+$/, "");
  const port = Number(env.PORT ?? 3200);
  return {
    databaseUrl,
    adminPassword,
    publicBaseUrl,
    inviteBaseUrl: (env.INVITE_BASE_URL ?? publicBaseUrl).replace(/\/+$/, ""),
    port,
    secureCookies: publicBaseUrl.startsWith("https://"),
    webDistDir: env.JUDGE_WEB_DIST ?? null,
  };
}
