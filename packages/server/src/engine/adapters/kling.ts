/**
 * Kling 视频适配器（快手可灵）
 *
 * 协议来源（hybrid）：
 *   - newapi 模式：假设 New API 站点已把 kling 封装为 OpenAI 兼容异步协议
 *     POST /v1/videos/submit    { prompt, model, duration?, ... }
 *     GET  /v1/videos/{id}      { id, status, result? }
 *   - direct 模式：直连 klingai.com 官方 API
 *     POST {baseUrl}/v1/videos/text2video
 *     GET {baseUrl}/v1/videos/text2video/{id}
 *
 * 官方文档参考（2026-08-16）：https://platform.klingai.com/docs
 *   - 鉴权：HJ-Token 头（由 access_key + secret_key 派生，本适配器只接受已派生的 token）；
 *           调用方应提前回填到 ctx.apiKey
 *   - 提交：POST /v1/videos/text2video
 *           body: { model_name, prompt, duration, aspect_ratio, ... }
 *           回包: { code, data: { task_id, task_status } }
 *   - 查询：GET /v1/videos/text2video/{task_id}
 *           回包: { code, data: { task_id, task_status, task_result: { videos:[{url, duration, ...}] } } }
 *   - 状态枚举：submitted / processing / succeed / failed
 *
 * adapterConfig.video 形状：
 *   {
 *     "mode": "newapi" | "direct",
 *     "endpoint": "videos",                  // newapi 模式端点前缀
 *     "vendor": {                            // direct 模式
 *       "baseUrl": "https://api.klingai.com",
 *       "submitPath": "/v1/videos/text2video",
 *       "queryPath": "/v1/videos/text2video/{id}",
 *       "resultField": "task_result.videos[0].url"  // 没用上，固定路径解析
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

interface KlingVideoConfig {
  mode?: "newapi" | "direct";
  endpoint?: string;
  vendor?: {
    baseUrl?: string;
    submitPath?: string;
    queryPath?: string;
  };
}

function getConfig(ctx: ForwardContext): Required<Pick<KlingVideoConfig, "mode" | "endpoint">> & {
  vendor: NonNullable<KlingVideoConfig["vendor"]>;
} {
  const cfg = (ctx.config?.video as KlingVideoConfig | undefined) ?? {};
  return {
    mode: cfg.mode ?? "newapi",
    endpoint: cfg.endpoint ?? "videos",
    vendor: cfg.vendor ?? {
      baseUrl: "https://api.klingai.com",
      submitPath: "/v1/videos/text2video",
      queryPath: "/v1/videos/text2video/{id}",
    },
  };
}

function baseUrl(url: string): string {
  return url.replace(/\/$/, "");
}

async function toError(response: Response, capability: string): Promise<Error> {
  const text = await response.text().catch(() => response.statusText);
  const err = new Error(`kling adapter [${capability}] ${response.status}: ${text}`);
  (err as Error & { status?: number; adapter?: string; capability?: string }).status = response.status;
  (err as Error & { status?: number; adapter?: string; capability?: string }).adapter = "kling";
  (err as Error & { status?: number; adapter?: string; capability?: string }).capability = capability;
  return err;
}

/**
 * Kling 官方状态映射：submitted/processing → pending/processing
 *                                 succeed → completed
 *                                 failed → failed
 */
function mapKlingStatus(siteStatus: unknown): VideoTaskStatus {
  if (typeof siteStatus !== "string") return "processing";
  const s = siteStatus.toLowerCase();
  if (s === "submitted") return "pending";
  if (s === "succeed") return "completed";
  if (s === "failed") return "failed";
  return mapGenericVideoStatus(s);
}

export const klingAdapter: Adapter = {
  id: "kling",
  capabilities: [
    "models.list",
    "video.submit",
    "video.query",
  ],

  async forwardChat() {
    throw new Error("kling adapter does not support chat");
  },
  async forwardChatStream() {
    throw new Error("kling adapter does not support chat.stream");
  },
  async healthCheck(ctx: ForwardContext): Promise<boolean> {
    const cfg = getConfig(ctx);
    if (cfg.mode === "direct") {
      // direct 模式：ping 查询一个不存在的 id 会拿到 404，但证明鉴权通过
      try {
        const queryPath = cfg.vendor.queryPath ?? "/v1/videos/text2video/{id}";
        const url = `${cfg.vendor.baseUrl}${queryPath.replace("{id}", "ping-health")}`;
        const r = await fetch(url, {
          headers: { Authorization: `Bearer ${ctx.apiKey}` },
          signal: AbortSignal.timeout(5000),
        });
        // 401/403 说明 key 错；其它（404/200）至少说明能联通
        return r.status !== 401 && r.status !== 403;
      } catch {
        return false;
      }
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
      const data = (await response.json()) as {
        code?: number;
        data?: { task_id?: string; task_status?: string };
      };
      if (data.code !== 0 || !data.data?.task_id) {
        throw new Error(`kling direct submit failed: code=${data.code} payload=${JSON.stringify(data)}`);
      }
      return {
        siteTaskId: data.data.task_id,
        initialStatus: mapKlingStatus(data.data.task_status),
        rawResult: data,
      };
    }

    // newapi 模式
    const url = `${baseUrl(ctx.targetUrl)}/v1/${cfg.endpoint}/submit`;
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
    if (!data.id) throw new Error("kling newapi submit response missing id");
    return {
      siteTaskId: data.id,
      initialStatus: mapGenericVideoStatus(data.status ?? "processing"),
      rawResult: data,
    };
  },

  async queryVideoTask(siteTaskId: string, ctx: ForwardContext): Promise<VideoQueryResult> {
    const cfg = getConfig(ctx);
    if (cfg.mode === "direct") {
      const queryPath = cfg.vendor.queryPath ?? "/v1/videos/text2video/{id}";
      const url = `${cfg.vendor.baseUrl}${queryPath.replace("{id}", encodeURIComponent(siteTaskId))}`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${ctx.apiKey}` },
      });
      if (!response.ok) throw await toError(response, "video.query");
      const data = (await response.json()) as {
        code?: number;
        data?: {
          task_id?: string;
          task_status?: string;
          task_result?: { videos?: Array<{ url?: string; duration?: string; width?: number; height?: number }> };
          task_status_msg?: string;
        };
      };
      if (data.code !== 0 || !data.data) {
        return {
          status: "failed",
          error: data.data?.task_status_msg ?? `kling query code=${data.code}`,
          raw: data,
        };
      }
      const videoUrl = data.data.task_result?.videos?.[0]?.url;
      return {
        status: mapKlingStatus(data.data.task_status),
        result: videoUrl
          ? {
              video_url: videoUrl,
              duration: data.data.task_result?.videos?.[0]?.duration
                ? Number(data.data.task_result.videos[0].duration)
                : undefined,
              width: data.data.task_result?.videos?.[0]?.width,
              height: data.data.task_result?.videos?.[0]?.height,
            }
          : undefined,
        raw: data,
      };
    }

    // newapi 模式
    const url = `${baseUrl(ctx.targetUrl)}/v1/${cfg.endpoint}/${encodeURIComponent(siteTaskId)}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
    });
    if (!response.ok) throw await toError(response, "video.query");
    const data = (await response.json()) as Record<string, unknown>;
    const statusField = (data.status as string) ?? "processing";
    const result = data.result as { video_url?: string; [k: string]: unknown } | undefined;
    return {
      status: mapGenericVideoStatus(statusField),
      result: result?.video_url
        ? {
            video_url: result.video_url,
            duration: typeof result.duration === "number" ? (result.duration as number) : undefined,
            width: typeof result.width === "number" ? (result.width as number) : undefined,
            height: typeof result.height === "number" ? (result.height as number) : undefined,
          }
        : undefined,
      raw: data,
    };
  },

  mapVideoStatus(siteStatus: unknown): VideoTaskStatus {
    return mapKlingStatus(siteStatus);
  },

  transformVideoResult(raw: unknown) {
    return raw as { video_url: string; [k: string]: unknown };
  },
};
