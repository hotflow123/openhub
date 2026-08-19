import { Hono } from "hono";
import { probeModel, probeUnknownModels, type ProbeMode } from "../../engine/capability/probes";
import { withAdminAuth } from "./_with-auth";

const probes = new Hono();
withAdminAuth(probes);

/**
 * POST /admin/probes/batch
 * 批量探测所有模型
 * body: { mode?: "none" | "safe" | "full"; limit?: number }
 */
probes.post("/probes/batch", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    mode?: ProbeMode;
    limit?: number;
  };
  const results = await probeUnknownModels(body.mode ?? "safe", body.limit ?? 20);
  const ok = results.filter((r) => !r.errorMessage).length;
  const failed = results.length - ok;
  return c.json({ data: { total: results.length, ok, failed, results } });
});

/**
 * POST /admin/probes/:modelId
 * 触发单个模型探测
 * body: { mode?: "none" | "safe" | "full" }
 */
probes.post("/probes/:modelId", async (c) => {
  const id = c.req.param("modelId");
  const body = (await c.req.json().catch(() => ({}))) as { mode?: ProbeMode };
  const result = await probeModel(id, body.mode ?? "safe");
  return c.json({ data: result });
});

export default probes;
