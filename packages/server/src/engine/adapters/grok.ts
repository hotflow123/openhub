/**
 * Grok Imagine Video 适配器（xAI Grok Imagine Video 1.5 / 1.5-preview）
 *
 * 协议来源（仅 direct 模式，xAI 官方）：
 *   POST https://api.x.ai/v1/videos/generations
 *     body: { model, prompt, image?: { url }, duration?, resolution?, aspect_ratio? }
 *     回包: { request_id }
 *   GET  https://api.x.ai/v1/videos/{request_id}
 *     回包: { request_id, status, video?: { url, ... } }
 *   状态枚举：pending / processing / done / failed / expired
 *
 * 官方文档参考（2026-08-16）：
 *   - https://docs.x.ai/developers/model-capabilities/video/generation
 *   - https://docs.x.ai/developers/model-capabilities/imagine
 *   - 鉴权：Authorization: Bearer {XAI_API_KEY}
 *
 * New API 站点目前没有 grok 视频的成熟封装（xAI 仅自家 API 提供），
 * 因此本适配器只实现 direct 模式。如果后续 New API 站点接入，可以扩展
 * adapterConfig.video.mode = "newapi" 子分支。
 *
 * adapterConfig.video 形状：
 *   {
 *     "mode": "direct",                    // 当前唯一支持的模式
 *     "vendor": {
 *       "baseUrl": "https://api.x.ai",
 *       "submitPath": "/v1/videos/generations",
 *       "queryPath": "/v1/videos/{id}"
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

interface GrokVideoConfig {
  mode?: "direct";
  vendor?: {
    baseUrl?: string;
    submitPath?: string;
    queryPath?: string;
  };
}

function getConfig(ctx: ForwardContext): Required<Pick<GrokVideoConfig, "mode">> & {
  vendor: NonNullable<GrokVideoConfig["vendor"]>;
} {
  const cfg = (ctx.config?.video as GrokVideoConfig | undefined) ?? {};
  return {
    mode: cfg.mode ?? "direct",
    vendor: cfg.vendor ?? {
      baseUrl: "https://api.x.ai",
      submitPath: "/v1/videos/generations",
      queryPath: "/v1/videos/{id}",
    },
  };
}

function baseUrl(url: string): string {
  return url.replace(/\/$/, "");
}

async function toError(response: Response, capability: string): Promise<Error> {
  const text = await response.text().catch(() => response.statusText);
  const err = new Error(`grok adapter [${capability}] ${response.status}: ${text}`);
  (err as Error & { status?: number; adapter?: string; capability?: string }).status = response.status;
  (err as Error & { status?: number; adapter?: string; capability?: string }).adapter = "grok";
  (err as Error & { status?: number; adapter?: string; capability?: string }).capability = capability;
  return err;
}

/**
 * xAI Grok Imagine 视频状态映射
 *   pending    → pending
 *   processing → processing
 *   done       → completed
 *   failed     → failed
 *   expired    → timeout（xAI 把过期的 request_id 标 expired，视为终止态）
 */
function mapGrokStatus(siteStatus: unknown): VideoTaskStatus {
  if (typeof siteStatus !== "string") return "processing";
  const s = siteStatus.toLowerCase();
  if (s === "pending") return "pending";
  if (s === "processing") return "processing";
  if (s === "done") return "completed";
  if (s === "failed") return "failed";
  if (s === "expired") return "timeout";
  return mapGenericVideoStatus(s);
}

/**
 * 从响应中提取 video_url，xAI 当前把结果放在 { video: { url, ... } }。
 * 也兼容直接把 url 放在顶层的情况（未来扩展）。
 */
function pickVideoUrl(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (r.video && typeof r.video === "object") {
    const v = r.video as Record<string, unknown>;
    if (typeof v.url === "string") return v.url;
  }
  if (typeof r.url === "string") return r.url;
  if (typeof r.video_url === "string") return r.video_url;
  return undefined;
}

export const grokAdapter: Adapter = {
  id: "grok",
  capabilities: [
    "models.list",
    "video.submit",
    "video.query",
  ],

  async forwardChat() {
    throw new Error("grok adapter does not support chat (text completion is a separate adapter)");
  },
  async forwardChatStream() {
    throw new Error("grok adapter does not support chat.stream");
  },
  async healthCheck(ctx: ForwardContext): Promise<boolean> {
    // xAI 没有公开的轻量探测端点；只要 apiKey 非空就视为可达，鉴权错误延后到提交时捕获
    return Boolean(ctx.apiKey);
  },

  // ───────── Video ─────────

  async submitVideoTask(
    req: VideoSubmitRequest,
    ctx: ForwardContext,
  ): Promise<VideoSubmitResult> {
    const cfg = getConfig(ctx);
    if (cfg.mode !== "direct") {
      // 当前不支持 newapi 模式（xAI 未被 New API 生态广泛封装）
      throw new Error(
        `grok adapter: mode "${cfg.mode}" is not supported yet (xAI Grok Imagine 视频仅支持 direct 模式)`,
      );
    }
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
    const data = (await response.json()) as { request_id?: string; status?: string };
    if (!data.request_id) {
      throw new Error(`grok submit response missing request_id: ${JSON.stringify(data)}`);
    }
    return {
      siteTaskId: data.request_id,
      initialStatus: mapGrokStatus(data.status ?? "pending"),
      rawResult: data,
    };
  },

  async queryVideoTask(siteTaskId: string, ctx: ForwardContext): Promise<VideoQueryResult> {
    const cfg = getConfig(ctx);
    if (cfg.mode !== "direct") {
      throw new Error(`grok adapter: mode "${cfg.mode}" is not supported yet`);
    }
    const queryPath = cfg.vendor.queryPath ?? "/v1/videos/{id}";
    const url = `${cfg.vendor.baseUrl}${queryPath.replace("{id}", encodeURIComponent(siteTaskId))}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
    });
    if (!response.ok) throw await toError(response, "video.query");
    const data = (await response.json()) as Record<string, unknown>;
    const statusField = (data.status as string) ?? "processing";
    const videoUrl = pickVideoUrl(data);
    return {
      status: mapGrokStatus(statusField),
      result: videoUrl ? { video_url: videoUrl } : undefined,
      raw: data,
    };
  },

  mapVideoStatus(siteStatus: unknown): VideoTaskStatus {
    return mapGrokStatus(siteStatus);
  },

  transformVideoResult(raw: unknown) {
    const url = pickVideoUrl(raw);
    return {
      video_url: url ?? "",
      ...((raw && typeof raw === "object") ? raw as Record<string, unknown> : {}),
    };
  },
};
