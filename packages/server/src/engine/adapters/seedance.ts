/**
 * Seedance 视频适配器（字节跳动 Seedance 1.0/1.5 Pro 系列）
 *
 * 协议来源（hybrid）：
 *   - newapi 模式：New API 站点把 seedance 封装为 OpenAI 兼容风格
 *     POST /v1/video/generations    { model, prompt, duration?, size?, aspect_ratio?, reference_image_url?, ... }
 *       回包: { id, status: "processing" | "queued" }
 *     GET  /v1/video/tasks/{id}
 *       回包: { id, status: "processing" | "completed" | "failed", result?: { url, duration?, width?, height? } }
 *   - direct 模式：直连字节官方 Volcano Ark（火山方舟）异步视频
 *     POST {baseUrl}/api/v3/contents/generations/tasks
 *       body: { model, content: [{ type: "text", text: prompt }, ...], parameters?: { ... } }
 *       回包: { id, status }
 *     GET  {baseUrl}/api/v3/contents/generations/tasks/{id}
 *
 * 官方文档参考（2026-08-16）：
 *   - https://www.volcengine.com/docs/82379/1399567
 *   - 鉴权：Authorization: Bearer {ARK_API_KEY}
 *   - 状态枚举：queued / running / succeeded / failed / cancelled
 *
 * adapterConfig.video 形状：
 *   {
 *     "mode": "newapi" | "direct",
 *     "endpoint": "video",                              // newapi 模式端点前缀
 *     "submitPath": "generations",                      // newapi 模式提交子路径
 *     "taskPath": "tasks",                              // newapi 模式查询子路径
 *     "vendor": {                                       // direct 模式
 *       "baseUrl": "https://ark.cn-beijing.volces.com",
 *       "submitPath": "/api/v3/contents/generations/tasks",
 *       "queryPath": "/api/v3/contents/generations/tasks/{id}"
 *     }
 *   }
 */

import {
  type Adapter,
  type ForwardContext,
  type VideoSubmitRequest,
  type VideoSubmitResult,
  type VideoQueryResult,
  type VideoTaskStatus,
} from "../adapter";
import { mapGenericVideoStatus } from "./openai";

interface SeedanceVideoConfig {
  mode?: "newapi" | "direct";
  endpoint?: string;
  submitPath?: string;
  taskPath?: string;
  vendor?: {
    baseUrl?: string;
    submitPath?: string;
    queryPath?: string;
  };
}

function getConfig(ctx: ForwardContext): Required<Pick<SeedanceVideoConfig, "mode" | "endpoint" | "submitPath" | "taskPath">> & {
  vendor: NonNullable<SeedanceVideoConfig["vendor"]>;
} {
  const cfg = (ctx.config?.video as SeedanceVideoConfig | undefined) ?? {};
  return {
    mode: cfg.mode ?? "newapi",
    endpoint: cfg.endpoint ?? "video",
    submitPath: cfg.submitPath ?? "generations",
    taskPath: cfg.taskPath ?? "tasks",
    vendor: cfg.vendor ?? {
      baseUrl: "https://ark.cn-beijing.volces.com",
      submitPath: "/api/v3/contents/generations/tasks",
      queryPath: "/api/v3/contents/generations/tasks/{id}",
    },
  };
}

function baseUrl(url: string): string {
  return url.replace(/\/$/, "");
}

async function toError(response: Response, capability: string): Promise<Error> {
  const text = await response.text().catch(() => response.statusText);
  const err = new Error(`seedance adapter [${capability}] ${response.status}: ${text}`);
  (err as Error & { status?: number; adapter?: string; capability?: string }).status = response.status;
  (err as Error & { status?: number; adapter?: string; capability?: string }).adapter = "seedance";
  (err as Error & { status?: number; adapter?: string; capability?: string }).capability = capability;
  return err;
}

/**
 * 字节方舟状态 → OpenHub 状态
 *   queued      → pending
 *   running     → processing
 *   succeeded   → completed
 *   failed      → failed
 *   cancelled   → failed
 */
function mapSeedanceDirectStatus(siteStatus: unknown): VideoTaskStatus {
  if (typeof siteStatus !== "string") return "processing";
  const s = siteStatus.toLowerCase();
  if (s === "queued") return "pending";
  if (s === "running") return "processing";
  if (s === "succeeded") return "completed";
  if (s === "failed" || s === "cancelled" || s === "canceled") return "failed";
  return mapGenericVideoStatus(s);
}

/**
 * 提取 query 响应中的 video_url：站点实现不一定统一，兼容几种写法
 *   - result.url
 *   - result.video_url
 *   - content[].url（方舟官方 content array）
 */
function pickVideoUrl(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.url === "string") return r.url;
  if (typeof r.video_url === "string") return r.video_url;
  if (Array.isArray(r.content)) {
    for (const item of r.content) {
      if (item && typeof item === "object" && typeof (item as Record<string, unknown>).url === "string") {
        return (item as { url: string }).url;
      }
    }
  }
  if (r.result && typeof r.result === "object") {
    return pickVideoUrl(r.result);
  }
  return undefined;
}

export const seedanceAdapter: Adapter = {
  id: "seedance",
  capabilities: [
    "models.list",
    "video.submit",
    "video.query",
  ],

  async forwardChat() {
    throw new Error("seedance adapter does not support chat");
  },
  async forwardChatStream() {
    throw new Error("seedance adapter does not support chat.stream");
  },
  async healthCheck(ctx: ForwardContext): Promise<boolean> {
    const cfg = getConfig(ctx);
    if (cfg.mode === "direct") {
      // direct 模式：火山方舟没有公开的轻量探测端点，直接判定为可达
      return Boolean(ctx.apiKey);
    }
    // newapi 模式：GET /v1/models
    try {
      const url = `${baseUrl(ctx.targetUrl)}/v1/models`;
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${ctx.apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      return r.ok;
    } catch {
      return false;
    }
  },

  // ───────── Video ─────────

  async submitVideoTask(
    req: VideoSubmitRequest,
    ctx: ForwardContext,
  ): Promise<VideoSubmitResult> {
    const cfg = getConfig(ctx);
    if (cfg.mode === "direct") {
      const url = `${cfg.vendor.baseUrl}${cfg.vendor.submitPath}`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ctx.apiKey}`,
        },
        body: JSON.stringify(req),
      });
      if (!response.ok) throw await toError(response, "video.submit");
      const data = (await response.json()) as { id?: string; status?: string };
      if (!data.id) throw new Error("seedance direct submit response missing id");
      return {
        siteTaskId: data.id,
        initialStatus: mapSeedanceDirectStatus(data.status ?? "queued"),
        rawResult: data,
      };
    }

    // newapi 模式：POST /v1/{endpoint}/{submitPath}   （New API 实际用 video/generations）
    const url = `${baseUrl(ctx.targetUrl)}/v1/${cfg.endpoint}/${cfg.submitPath}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ctx.apiKey}`,
      },
      body: JSON.stringify(req),
    });
    if (!response.ok) throw await toError(response, "video.submit");
    const data = (await response.json()) as { id?: string; task_id?: string; status?: string };
    const id = data.id ?? data.task_id;
    if (!id) throw new Error(`seedance newapi submit response missing id/task_id: ${JSON.stringify(data)}`);
    return {
      siteTaskId: id,
      initialStatus: mapSeedanceDirectStatus(data.status ?? "queued"),
      rawResult: data,
    };
  },

  async queryVideoTask(siteTaskId: string, ctx: ForwardContext): Promise<VideoQueryResult> {
    const cfg = getConfig(ctx);
    if (cfg.mode === "direct") {
      const queryPath = cfg.vendor.queryPath ?? "/api/v3/contents/generations/tasks/{id}";
      const url = `${cfg.vendor.baseUrl}${queryPath.replace("{id}", encodeURIComponent(siteTaskId))}`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${ctx.apiKey}` },
      });
      if (!response.ok) throw await toError(response, "video.query");
      const data = (await response.json()) as Record<string, unknown>;
      const statusField = (data.status as string) ?? "running";
      const videoUrl = pickVideoUrl(data);
      return {
        status: mapSeedanceDirectStatus(statusField),
        result: videoUrl ? { video_url: videoUrl } : undefined,
        raw: data,
      };
    }

    // newapi 模式：GET /v1/{endpoint}/{taskPath}/{id}
    const url = `${baseUrl(ctx.targetUrl)}/v1/${cfg.endpoint}/${cfg.taskPath}/${encodeURIComponent(siteTaskId)}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
    });
    if (!response.ok) throw await toError(response, "video.query");
    const data = (await response.json()) as Record<string, unknown>;
    const statusField = (data.status as string) ?? "processing";
    const videoUrl = pickVideoUrl(data);
    return {
      status: mapSeedanceDirectStatus(statusField),
      result: videoUrl
        ? {
            video_url: videoUrl,
            duration: typeof (data as { duration?: unknown }).duration === "number"
              ? ((data as { duration: number }).duration)
              : undefined,
            width: typeof (data as { width?: unknown }).width === "number"
              ? ((data as { width: number }).width)
              : undefined,
            height: typeof (data as { height?: unknown }).height === "number"
              ? ((data as { height: number }).height)
              : undefined,
          }
        : undefined,
      raw: data,
    };
  },

  mapVideoStatus(siteStatus: unknown): VideoTaskStatus {
    return mapSeedanceDirectStatus(siteStatus);
  },

  transformVideoResult(raw: unknown) {
    const url = pickVideoUrl(raw);
    return { video_url: url ?? "", ...((raw && typeof raw === "object") ? raw as Record<string, unknown> : {}) };
  },
};
