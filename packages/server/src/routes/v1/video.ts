/**
 * /v1/video/* 路由
 *
 * - POST /v1/video/generations    提交异步视频任务
 * - GET  /v1/video/tasks/:id      查询任务（必须为任务提交方）
 * - GET  /v1/video/tasks          列出当前 key 的所有任务
 *
 * OpenAI 没有视频异步 API；本路由是 OpenHub 自定义。
 */

import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import { authMiddleware } from "../../middleware/auth";
import { db } from "../../db/index";
import { tasks } from "../../db/schema/index";
import { createTask, getTask, parseTaskMeta, parseTaskResult } from "../../engine/tasks/service";
import { validateModelRequest } from "../../lib/model-contract";
import { resolveRoute, RouterError } from "../router";

const video = new Hono();
video.use("/v1/video/*", authMiddleware);

function errorResponse(status: number, message: string, code?: string) {
  return new Response(
    JSON.stringify({ error: { message, type: "router_error", code } }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

video.post("/v1/video/generations", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json());
  } catch {
    return errorResponse(400, "Invalid JSON body", "invalid_json");
  }

  const model = String(body.model ?? "");
  if (!model) return errorResponse(400, "Missing model (variant name)", "missing_model");
  const prompt = String(body.prompt ?? "");
  if (!prompt) return errorResponse(400, "Missing prompt", "missing_prompt");

  let chain;
  try {
    chain = await resolveRoute(model);
  } catch (err) {
    if (err instanceof RouterError) return errorResponse(err.status, err.message, err.code);
    throw err;
  }

  if (!chain.adapter.submitVideoTask) {
    return errorResponse(
      400,
      `Adapter ${chain.adapter.id} does not support video.submit`,
      "capability_unsupported",
    );
  }

  let fieldMapping: Record<string, string> = {};
  try {
    const parsed = chain.variant.fieldMapping ? JSON.parse(chain.variant.fieldMapping) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      fieldMapping = parsed as Record<string, string>;
    }
  } catch {
    return errorResponse(500, "Variant field_mapping is invalid JSON", "invalid_field_mapping");
  }

  let paramLimits: Record<string, string[]> = {};
  try {
    const parsed = chain.variant.paramLimits ? JSON.parse(chain.variant.paramLimits) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [field, values] of Object.entries(parsed as Record<string, unknown>)) {
        if (Array.isArray(values) && values.every((value) => typeof value === "string")) {
          paramLimits[field] = values as string[];
        }
      }
    }
  } catch {
    return errorResponse(500, "Variant param_limits is invalid JSON", "invalid_param_limits");
  }

  const contractError = validateModelRequest(
    body,
    chain.model,
    {
      maxReferenceImages: chain.variant.maxReferenceImages,
      maxReferenceVideos: chain.variant.maxReferenceVideos,
      maxReferenceAudios: chain.variant.maxReferenceAudios,
    },
    fieldMapping,
    paramLimits,
  );
  if (contractError) {
    return errorResponse(400, contractError, "model_parameter_invalid");
  }

  const hubKey = c.get("hubKey");

  const callbackUrl = typeof body.callback_url === "string" ? body.callback_url : undefined;
  if (callbackUrl && !/^https:\/\//i.test(callbackUrl)) {
    return errorResponse(400, "callback_url must be https://", "invalid_callback_url");
  }

  // Persist the complete JSON request needed by the asynchronous worker.
  // Transport-only fields are excluded; the task GET endpoint redacts prompt/media fields.
  const { model: _requestedModel, callback_url: _callback, idempotency_key: _idempotency, ...requestParams } = body;
  const meta: Record<string, unknown> = {
    ...requestParams,
    model: chain.model.rawName,
    variant_id: chain.variant.id,
  };

  const idempotencyKey =
    typeof body.idempotency_key === "string" && body.idempotency_key.length > 0
      ? body.idempotency_key
      : (c.req.header("Idempotency-Key") ?? null);

  const { task, created } = await createTask({
    siteId: chain.site.id,
    variantId: chain.variant.id,
    modelId: chain.model.id,
    createdByKeyId: hubKey.id,
    type: "video",
    idempotencyKey,
    taskMeta: meta,
    callbackUrl,
    callbackSecret: undefined,
  });

  // 如果是新建任务且当前进程 worker 已经在跑，下一轮轮询会处理它；
  // 这里也尝试立刻提交一次以减少首字节延迟。
  if (created) {
    const { submitPendingTasks } = await import("../../engine/tasks/worker");
    submitPendingTasks().catch((e) =>
      console.error("[video] immediate submit failed:", e),
    );
  }

  return c.json({
    id: task.id,
    status: task.status,
    created_at: Math.floor(task.createdAt.getTime() / 1000),
  });
});

video.get("/v1/video/tasks/:id", async (c) => {
  const id = c.req.param("id");
  const hubKey = c.get("hubKey");
  const task = await getTask(id);
  if (!task) return errorResponse(404, "Task not found", "task_not_found");
  if (task.createdByKeyId !== hubKey.id) {
    return errorResponse(403, "Not allowed to read this task", "forbidden");
  }

  const now = Date.now();
  const resultObj = parseTaskResult(task);
  const resultExpires = task.resultExpiresAt?.getTime() ?? null;
  const resultExpired = resultExpires != null && resultExpires < now;

  const safeMeta = parseTaskMeta(task);
  if (safeMeta) {
    delete safeMeta.prompt;
    delete safeMeta.image_url;
    delete safeMeta.image_urls;
    delete safeMeta.video_url;
    delete safeMeta.video_urls;
    delete safeMeta.audio_url;
    delete safeMeta.audio_urls;
    delete safeMeta.reference_image_url;
    delete safeMeta.reference_image_urls;
    delete safeMeta.reference_video_url;
    delete safeMeta.reference_video_urls;
    delete safeMeta.reference_audio_url;
    delete safeMeta.reference_audio_urls;
  }
  return c.json({
    id: task.id,
    status: task.status,
    created_at: Math.floor(task.createdAt.getTime() / 1000),
    started_at: task.startedAt ? Math.floor(task.startedAt.getTime() / 1000) : null,
    completed_at: task.completedAt ? Math.floor(task.completedAt.getTime() / 1000) : null,
    result: resultObj,
    result_expires_at: resultExpires ? Math.floor(resultExpires / 1000) : null,
    result_url_expired: resultExpired,
    error: task.error,
    meta: safeMeta,
    poll_count: task.pollCount,
  });
});

video.get("/v1/video/tasks", async (c) => {
  const hubKey = c.get("hubKey");
  const rows = await db
    .select()
    .from(tasks)
    .where(eq(tasks.createdByKeyId, hubKey.id))
    .orderBy(desc(tasks.createdAt))
    .limit(100);
  return c.json({
    data: rows.map((t) => ({
      id: t.id,
      status: t.status,
      type: t.type,
      created_at: Math.floor(t.createdAt.getTime() / 1000),
      completed_at: t.completedAt ? Math.floor(t.completedAt.getTime() / 1000) : null,
    })),
  });
});

export default video;
