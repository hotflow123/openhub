const BASE = "";

export interface ApiError {
  status: number;
  message: string;
}

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(BASE + path, {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Authorization:
          "Basic " +
          btoa(
            `${import.meta.env.VITE_ADMIN_USER ?? "admin"}:${
              import.meta.env.VITE_ADMIN_PASS ?? "admin123"
            }`,
          ),
        ...(init?.headers ?? {}),
      },
      ...init,
      signal: controller.signal,
    });
    if (!res.ok) {
      let msg = res.statusText;
      try {
        const body = await res.json();
        msg = body?.error?.message ?? body?.message ?? msg;
      } catch {}
      throw { status: res.status, message: msg } satisfies ApiError;
    }
    return res.json();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw { status: 408, message: "请求超时，请检查后端服务是否正常运行。" } satisfies ApiError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
