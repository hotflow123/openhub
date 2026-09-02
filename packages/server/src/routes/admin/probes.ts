import { Hono } from "hono";
import { ProbeModeSchema, probeModel, probeUnknownModels, summarizeProbe } from "../../engine/capability/probes";
import { withAdminAuth } from "./_with-auth";

const probes = new Hono();
withAdminAuth(probes);

/**
 * POST /admin/probes/batch
 * 批量探测所有模型
 * body: { mode?: "none" | "safe" | "full"; limit?: number }
 */
probes.post("/probes/batch", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { mode?: unknown; limit?: unknown };
  const mode = ProbeModeSchema.safeParse(body.mode ?? "safe");
  if (!mode.success) return c.json({ error: { message: "Invalid probe mode", code: "invalid_probe_mode" } }, 400);
  if (mode.data === "full") {
    return c.json({ error: { message: "实际调用验证必须逐个模型执行", code: "live_probe_batch_forbidden" } }, 400);
  }
  const limit = typeof body.limit === "number" && Number.isInteger(body.limit) ? body.limit : 20;
  const results = await probeUnknownModels(mode.data, limit);
  const available = results.filter((r) => r.status === "available").length;
  const unresolved = results.length - available;
  return c.json({
    data: {
      total: results.length,
      available,
      unresolved,
      results: results.map((result) => ({ ...result, ...summarizeProbe(result) })),
    },
  });
});

/**
 * POST /admin/probes/:modelId
 * 触发单个模型探测
 * body: { mode?: "none" | "safe" | "full" }
 */
probes.post("/probes/:modelId", async (c) => {
  const id = c.req.param("modelId");
  const body = (await c.req.json().catch(() => ({}))) as { mode?: unknown; confirm?: unknown; variantId?: unknown };
  const mode = ProbeModeSchema.safeParse(body.mode ?? "safe");
  if (!mode.success) return c.json({ error: { message: "Invalid probe mode", code: "invalid_probe_mode" } }, 400);
  const confirmLive = body.confirm === true;
  if (mode.data === "full" && !confirmLive) {
    return c.json({ error: { message: "实际调用验证需要明确确认", code: "live_probe_confirmation_required" } }, 400);
  }
  const result = await probeModel(id, mode.data, {
    confirmLive,
    variantId: typeof body.variantId === "string" ? body.variantId : undefined,
  });
  return c.json({ data: { ...result, ...summarizeProbe(result) } });
});

export default probes;
