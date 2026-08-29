import { MemeFastError, type MemeFastErrorCode, type MemeFastErrorInfo } from "./types.js";

export function normalizeBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new MemeFastError({ code: "invalid_config", operation: "config", message: "baseUrl must be a valid URL" });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new MemeFastError({ code: "invalid_config", operation: "config", message: "baseUrl must use http:// or https://" });
  }
  if (parsed.search || parsed.hash) {
    throw new MemeFastError({ code: "invalid_config", operation: "config", message: "baseUrl must not contain a query string or hash" });
  }
  const path = parsed.pathname.replace(/\/+$/, "");
  parsed.pathname = path.endsWith("/v1") ? path : path ? `${path}/v1` : "/v1";
  return parsed.toString().replace(/\/$/, "");
}

export function endpointUrl(baseUrl: string, path: string): string {
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

export function requestIdFrom(response: Response): string | undefined {
  return response.headers.get("x-request-id") ?? response.headers.get("request-id") ?? undefined;
}

export async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function errorInfo(
  code: MemeFastErrorCode,
  operation: string,
  message: string,
  extra: Partial<MemeFastErrorInfo> = {},
): MemeFastErrorInfo {
  return { code, operation, message, ...extra };
}

export async function request(
  url: string,
  apiKey: string,
  operation: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(init.headers ?? {}),
      },
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new MemeFastError(errorInfo(
      "network_error",
      operation,
      error instanceof Error ? error.message : "MemeFast request failed",
    ));
  }
  if (response.ok) return response;
  const details = await readResponseBody(response);
  const message = typeof details === "string" ? details : `${response.status} ${response.statusText}`;
  throw new MemeFastError(errorInfo("upstream_error", operation, message, {
    status: response.status,
    requestId: requestIdFrom(response),
    details,
  }));
}
