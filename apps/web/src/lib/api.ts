// API 客户端：统一错误信封 → ApiError；同源 cookie 会话。
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!response.ok) {
    const envelope = parsed as { error?: { code?: string; message?: string; details?: unknown } } | null;
    throw new ApiError(
      envelope?.error?.code ?? "internal_error",
      envelope?.error?.message ?? `请求失败（${response.status}）`,
      response.status,
      envelope?.error?.details,
    );
  }
  return parsed as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
  upload: async <T>(path: string, file: File): Promise<T> => {
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`/api${path}`, { method: "POST", body: form });
    const text = await response.text();
    const parsed = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const envelope = parsed as { error?: { code?: string; message?: string } } | null;
      throw new ApiError(envelope?.error?.code ?? "internal_error", envelope?.error?.message ?? "上传失败", response.status);
    }
    return parsed as T;
  },
  rawUrl: (path: string) => `/api${path}`,
};

export function errorMessageKey(error: unknown): string {
  return error instanceof ApiError ? `errors.${error.code}` : "errors.internal_error";
}
