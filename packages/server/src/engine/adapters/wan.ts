/**
 * Wan 视频适配器（通义万相 / Alibaba DashScope）
 *
 * 协议来源（hybrid）：
 *   - newapi 模式：假设 New API 站点已把 wan 封装为 OpenAI 兼容异步协议
 *     POST /v1/videos              { prompt, model, duration?, ... }
 *     GET  /v1/videos/{id}         { id, status, result? }
 *   - direct 模式：直连 DashScope 官方 API
 *     POST {baseUrl}/api/v1/services/aigc/video-generation/video-synthesis
 *          body（application/x-www-form-urlencoded）:
 *            model=<wanx2.1-t2v-turbo>
 *            input.prompt=<text>
 *            parameters.size / parameters.duration
 *       回包: { output: { task_id }, request_id, code, message }
 *     GET  {baseUrl}/api/v1/tasks/{task_id}
 *       回包: { output: { task_id, task_status, video_url?, ... }, request_id, code }
 *
 * 官方文档参考（2026-08-16）：https://help.aliyun.com/zh/model-studio/developer-reference/api-reference-video
 *   - 鉴权：Authorization: Bearer {DASHSCOPE_API_KEY}
 *   - 提交：表单 POST
 *   - 任务状态枚举：PENDING / RUNNING / SUCCEEDED / FAILED / CANCELED
 *   - 完成时 output.video_url 为 CDN URL
 *
 * adapterConfig.video 形状：
 *   {
 *     "mode": "newapi" | "direct",
 *     "endpoint": "videos",                  // newapi 模式端点前缀
 *     "vendor": {                            // direct 模式
 *       "baseUrl": "https://dashscope.aliyuncs.com",
 *       "submitPath": "/api/v1/services/aigc/video-generation/video-synthesis",
 *       "queryPath": "/api/v1/tasks/{id}",
 *       "submitStyle": "form" | "json"       // 默认 form（官方）
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

interface WanVideoConfig {
  mode?: "newapi" | "direct";
  endpoint?: string;
  vendor?: {
    baseUrl?: string;
    submitPath?: string;
    queryPath?: string;
    submitStyle?: "form" | "json";
  };
}

function getConfig(ctx: ForwardContext): Required<Pick<WanVideoConfig, "mode" | "endpoint">> & {
  vendor: NonNullable<WanVideoConfig["vendor"]>;
} {
  const cfg = (ctx.config?.video as WanVideoConfig | undefined) ?? {};
  return {
    mode: cfg.mode ?? "newapi",
    endpoint: cfg.endpoint ?? "videos",
    vendor: cfg.vendor ?? {
      baseUrl: "https://dashscope.aliyuncs.com",
      submitPath: "/api/v1/services/aigc/video-generation/video-synthesis",
      queryPath: "/api/v1/tasks/{id}",
      submitStyle: "form",
    },
  };
}

function baseUrl(url: string): string {
  return url.replace(/\/$/, "");
}

async function toError(response: Response, capability: string): Promise<Error> {
  const text = await response.text().catch(() => response.statusText);
  const err = new Error(`wan adapter [${capability}] ${response.status}: ${text}`);
  (err as Error & { status?: number; adapter?: string; capability?: string }).status = response.status;
  (err as Error & { status?: number; adapter?: string; capability?: string }).adapter = "wan";
  (err as Error & { status?: number; adapter?: string; capability?: string }).capability = capability;
  return err;
}

/**
 * DashScope 官方状态 → OpenHub 状态
 *   PENDING    → pending
 *   RUNNING    → processing
 *   SUCCEEDED  → completed
 *   FAILED     → failed
 *   CANCELED   → failed
 */
function mapWanDirectStatus(siteStatus: unknown): VideoTaskStatus {
  if (typeof siteStatus !== "string") return "processing";
  const s = siteStatus.toUpperCase();
  if (s === "PENDING") return "pending";
  if (s === "RUNNING") return "processing";
  if (s === "SUCCEEDED") return "completed";
  if (s === "FAILED" || s === "CANCELED") return "failed";
  return mapGenericVideoStatus(s);
}

/**
 * 把 { prompt, model, duration, ... } 拍扁成 DashScope 官方要求的表单字段。
 * 仅在直接模式、表单提交时使用。
 */
function toDashScopeFormBody(req: VideoSubmitRequest): string {
  const params: Record<string, string> = {};
  const paramsIn = (req as { parameters?: Record<string, unknown> }).parameters;
  if (paramsIn && typeof paramsIn === "object") {
    for (const [k, v] of Object.entries(paramsIn)) {
      params[k] = String(v);
    }
  }
  // 顶层字段：model + input.prompt
  const form: Record<string, string> = {};
  if (typeof req.model === "string") form.model = req.model;
  // input.prompt 用点号 key（DashScope 接受 application/x-www-form-urlencoded 且 key 支持点路径）
  if (typeof req.prompt === "string") form["input.prompt"] = req.prompt;
  // parameters.* 也并入（duration/size/aspect_ratio 等）
  for (const [k, v] of Object.entries(params)) {
    form[`parameters.${k}`] = v;
  }
  return new URLSearchParams(form).toString();
}

export const wanAdapter: Adapter = {
  id: "wan",
  capabilities: [
    "models.list",
    "video.submit",
    "video.query",
  ],

  async forwardChat() {
    throw new Error("wan adapter does not support chat");
  },
  async forwardChatStream() {
    throw new Error("wan adapter does not support chat.stream");
  },
  async healthCheck(ctx: ForwardContext): Promise<boolean> {
    const cfg = getConfig(ctx);
    if (cfg.mode === "direct") {
      // direct 模式：dashscope 没有公开的轻量探测端点；这里直接判定为可达（鉴权错误会延迟到提交时捕获）
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
      const submitStyle = cfg.vendor.submitStyle ?? "form";
      const headers: Record<string, string> = {
        Authorization: `Bearer ${ctx.apiKey}`,
      };
      let body: string;
      if (submitStyle === "json") {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(req);
      } else {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
        body = toDashScopeFormBody(req);
      }
      const response = await fetch(url, {
        method: "POST",
        headers,
        body,
      });
      if (!response.ok) throw await toError(response, "video.submit");
      const data = (await response.json()) as {
        output?: { task_id?: string; task_status?: string };
        code?: string;
        message?: string;
      };
      if (data.code && data.code !== "200" && data.code !== "Success") {
        throw new Error(
          `wan direct submit failed: code=${data.code} message=${data.message ?? ""}`,
        );
      }
      const taskId = data.output?.task_id;
      if (!taskId) {
        throw new Error(`wan direct submit: missing output.task_id in ${JSON.stringify(data)}`);
      }
      return {
        siteTaskId: taskId,
        initialStatus: mapWanDirectStatus(data.output?.task_status ?? "PENDING"),
        rawResult: data,
      };
    }

    // newapi 模式（OpenAI 兼容：POST /v1/{endpoint}，没有 /submit 后缀）
    const url = `${baseUrl(ctx.targetUrl)}/v1/${cfg.endpoint}`;
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
    if (!data.id) throw new Error("wan newapi submit response missing id");
    return {
      siteTaskId: data.id,
      initialStatus: mapGenericVideoStatus(data.status ?? "processing"),
      rawResult: data,
    };
  },

  async queryVideoTask(siteTaskId: string, ctx: ForwardContext): Promise<VideoQueryResult> {
    const cfg = getConfig(ctx);
    if (cfg.mode === "direct") {
      const queryPath = cfg.vendor.queryPath ?? "/api/v1/tasks/{id}";
      const url = `${cfg.vendor.baseUrl}${queryPath.replace("{id}", encodeURIComponent(siteTaskId))}`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${ctx.apiKey}` },
      });
      if (!response.ok) throw await toError(response, "video.query");
      const data = (await response.json()) as {
        output?: {
          task_id?: string;
          task_status?: string;
          video_url?: string;
          submit_time?: string;
          end_time?: string;
          orig_prompt?: string;
        };
        code?: string;
        message?: string;
      };
      if (data.code && data.code !== "200" && data.code !== "Success") {
        return {
          status: "failed",
          error: data.message ?? `wan direct query code=${data.code}`,
          raw: data,
        };
      }
      const out = data.output ?? {};
      const videoUrl = out.video_url;
      return {
        status: mapWanDirectStatus(out.task_status ?? "RUNNING"),
        result: videoUrl
          ? {
              video_url: videoUrl,
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
    // 通用入口：优先按大写判断 DashScope 风格，失败回退 generic
    if (typeof siteStatus === "string") {
      const upper = siteStatus.toUpperCase();
      if (upper === "PENDING" || upper === "RUNNING" || upper === "SUCCEEDED") {
        return mapWanDirectStatus(upper);
      }
    }
    return mapGenericVideoStatus(siteStatus);
  },

  transformVideoResult(raw: unknown) {
    return raw as { video_url: string; [k: string]: unknown };
  },
};
