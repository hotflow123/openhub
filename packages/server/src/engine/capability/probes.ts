import { z } from "zod";
import { db } from "../../db/index";
import { models, sites } from "../../db/schema/index";
import { eq } from "drizzle-orm";
import { decrypt, getMasterKey } from "../../lib/crypto";

/**
 * 能力探测模块 — 第五层（可选）
 *
 * 模式:
 *  - none: 不探测
 *  - safe: 仅 GET /v1/models/{id} 或 HEAD，不产生费用
 *  - full: 发送最小生成请求（默认禁用）
 *
 * 探测结果写入 models.suggested_* 字段，等待管理员确认。
 */

export const ProbeModeSchema = z.enum(["none", "safe", "full"]);
export type ProbeMode = z.infer<typeof ProbeModeSchema>;

const DEFAULT_PROBE_MODE: ProbeMode =
  (process.env.OPENHUB_PROBE_MODE as ProbeMode) ?? "none";

/**
 * 对单个模型执行探测
 * @returns 无副作用地返回推断的能力
 */
export interface ProbeResult {
  modelId: string;
  modality?: "llm" | "image" | "audio" | "video" | "embedding";
  endpointCaps?: string[];
  paramCaps?: string[];
  contextWindow?: number;
  supportsStream?: boolean;
  supportsReasoning?: boolean;
  errorMessage?: string;
  probedAt: Date;
}

export async function probeModel(
  modelId: string,
  mode: ProbeMode = DEFAULT_PROBE_MODE,
): Promise<ProbeResult> {
  const result: ProbeResult = { modelId, probedAt: new Date() };

  if (mode === "none") {
    result.errorMessage = "probe disabled";
    return result;
  }

  // 读 model + site
  const [row] = await db
    .select({
      id: models.id,
      rawName: models.rawName,
      siteId: models.siteId,
      baseUrl: sites.baseUrl,
      apiKeyEnc: sites.apiKeyEnc,
      apiKeyIv: sites.apiKeyIv,
    })
    .from(models)
    .leftJoin(sites, eq(models.siteId, sites.id))
    .where(eq(models.id, modelId))
    .limit(1);

  if (!row || !row.baseUrl || !row.apiKeyEnc || !row.apiKeyIv) {
    result.errorMessage = "model or site not found";
    return result;
  }

  const apiKey = await decrypt(row.apiKeyEnc, row.apiKeyIv, getMasterKey());

  try {
    if (mode === "safe") {
      // 安全探测：仅调用 /v1/models/{id} 验证 endpoint 是否存在
      const url = `${row.baseUrl.replace(/\/$/, "")}/v1/models/${encodeURIComponent(row.rawName)}`;
      const resp = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) {
        result.errorMessage = `safe probe ${resp.status}`;
        return result;
      }
      // 探到 = endpoint 存在，标记 supportsStream=true（默认值）
      result.supportsStream = true;
      return result;
    }

    if (mode === "full") {
      // 全探测：发送最小生成请求；需要谨慎
      // LLM: 1 token chat
      const url = `${row.baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: row.rawName,
          messages: [{ role: "user", content: "ok" }],
          max_tokens: 1,
          stream: false,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) {
        result.errorMessage = `full probe ${resp.status}`;
        return result;
      }
      const json = (await resp.json()) as Record<string, unknown>;
      // 推断 modality
      if (json.choices || json.usage) {
        result.modality = "llm";
        result.endpointCaps = ["chat"];
        result.paramCaps = ["stream"];
      }
      return result;
    }
  } catch (e) {
    result.errorMessage = e instanceof Error ? e.message : String(e);
  }
  return result;
}

/**
 * 批量探测数据库中所有模型（默认限制 50，按 site 遍历）
 * @returns 探测结果数组
 */
export async function probeUnknownModels(
  mode: ProbeMode = DEFAULT_PROBE_MODE,
  limit = 50,
): Promise<ProbeResult[]> {
  // 探测所有有 site 关联的模型（不限 modality，目的是健康检查）
  const rows = await db
    .select({ id: models.id })
    .from(models)
    .limit(limit);

  const results: ProbeResult[] = [];
  for (const r of rows) {
    const res = await probeModel(r.id, mode);
    results.push(res);
  }
  return results;
}

/**
 * 把 probe 结果 translate 到 DB
 * - 直接写正式字段（modality/endpointCaps/paramCaps）
 * - 不会覆盖 capsOverridden=1 的字段（已被管理员人工设置）
 * - 等待管理员在向导内微调
 */
export async function applyProbeSuggestions(
  result: ProbeResult,
): Promise<void> {
  if (result.errorMessage) return;
  const [row] = await db
    .select({ capsOverridden: models.capsOverridden })
    .from(models)
    .where(eq(models.id, result.modelId))
    .limit(1);
  if (!row || row.capsOverridden === 1) return; // 已被人工覆盖

  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (result.modality) update.modality = result.modality;
  if (result.endpointCaps)
    update.endpointCaps = JSON.stringify(result.endpointCaps);
  if (result.paramCaps) update.paramCaps = JSON.stringify(result.paramCaps);

  if (Object.keys(update).length === 1) return; // 只 updatedAt，跳过
  await db.update(models).set(update).where(eq(models.id, result.modelId));
}
