export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgres://judge:judge@localhost:5544/judge_e2e";
export const E2E_ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "e2e-admin-password-123456";
export const E2E_PORT = process.env.E2E_PORT ?? "3210";
export const E2E_BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${E2E_PORT}`;
