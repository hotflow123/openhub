import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../../db/index";
import { variants, models, sites, keys } from "../../db/schema/index";
import { writeAudit } from "../../lib/audit";
import {
  getAdapter,
  normalizeAdapterId,
  validateAdapterCapability,
  validateAdapterConfig,
} from "../../engine/adapter";
import {
  validateVariantLimits,
  validateParameterLimitsAgainstModel,
  type ModelParameterLimits,
} from "../../lib/model-contract";
import { withAdminAuth } from "./_with-auth";

const variantsRoute = new Hono();
withAdminAuth(variantsRoute);

const VariantSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  description: z.string().nullable().optional(),
  modelId: z.string().min(1).optional(),
  adapterConfig: z.record(z.string(), z.unknown()).nullable().optional(),
  paramOverrides: z.record(z.string(), z.unknown()).nullable().optional(),
  paramBlocked: z.array(z.string()).nullable().optional(),
  fieldMapping: z.record(z.string(), z.string()).nullable().optional(),
  paramLimits: z.record(z.string(), z.array(z.string())).nullable().optional(),
  maxContext: z.number().int().positive().nullable().optional(),
  maxOutput: z.number().int().positive().nullable().optional(),
  maxImages: z.number().int().positive().nullable().optional(),
  maxReferenceImages: z.number().int().nonnegative().nullable().optional(),
  maxReferenceVideos: z.number().int().nonnegative().nullable().optional(),
  maxReferenceAudios: z.number().int().nonnegative().nullable().optional(),
  maxDuration: z.number().int().positive().nullable().optional(),
  maxAudioLen: z.number().int().positive().nullable().optional(),
  isPublic: z.number().int().min(0).max(1).optional(),
});

function toStored(value: unknown) { return value === null || value === undefined ? null : JSON.stringify(value); }

function fromStoredObject(value: string | null | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function fromStoredParamLimits(value: string | null | undefined): ModelParameterLimits | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const result: ModelParameterLimits = {};
    for (const [field, values] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(values) && values.every((item) => typeof item === "string")) {
        result[field] = values as string[];
      }
    }
    return result;
  } catch {
    return undefined;
  }
}

async function validateVariantWrite(
  modelId: string,
  adapterConfig: Record<string, unknown> | undefined,
  paramLimits: ModelParameterLimits | undefined,
  limits: {
    maxReferenceImages?: number | null;
    maxReferenceVideos?: number | null;
    maxReferenceAudios?: number | null;
    maxDuration?: number | null;
  },
) {
  const [model] = await db.select().from(models).where(eq(models.id, modelId)).limit(1);
  if (!model) return { error: "Model not found", status: 400 as const };
  const [site] = await db.select().from(sites).where(eq(sites.id, model.siteId)).limit(1);
  if (!site) return { error: "Site not found", status: 500 as const };
  if (site.status !== "active") {
    return {
      error: `Site ${site.name} is ${site.status}; activate it before creating a callable variant`,
      status: 409 as const,
      code: "site_unavailable",
    };
  }

  const adapterId = normalizeAdapterId(model.adapterId);
  const adapter = adapterId ? getAdapter(adapterId) : undefined;
  if (!adapter || !adapterId) {
    return {
      error: `Adapter not found for model: ${model.adapterId}`,
      status: 400 as const,
      code: "adapter_not_found",
    };
  }
  const capabilityError = validateAdapterCapability(adapter, model.modality);
  if (capabilityError) {
    return { error: capabilityError, status: 400 as const, code: "adapter_capability_unsupported" };
  }
  const adapterConfigError = validateAdapterConfig(adapter, adapterConfig, model.modality);
  if (adapterConfigError) {
    return { error: adapterConfigError, status: 400 as const, code: "adapter_config_invalid" };
  }
  const paramLimitsError = validateParameterLimitsAgainstModel(paramLimits ?? {}, model);
  if (paramLimitsError) {
    return { error: paramLimitsError, status: 400 as const, code: "model_constraint_invalid" };
  }

  const constraintError = validateVariantLimits({
    maxReferenceImages: limits.maxReferenceImages ?? null,
    maxReferenceVideos: limits.maxReferenceVideos ?? null,
    maxReferenceAudios: limits.maxReferenceAudios ?? null,
    maxDurationSec: limits.maxDuration ?? null,
  }, model);
  if (constraintError) {
    return { error: constraintError, status: 400 as const, code: "model_constraint_invalid" };
  }

  return { model, site, adapterId };
}

variantsRoute.get("/variants", async (c) => {
  const rows = await db.select().from(variants);
  return c.json({ data: rows });
});

variantsRoute.post("/variants", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = VariantSchema.extend({ name: z.string().min(1).max(64), modelId: z.string().min(1) }).safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const validation = await validateVariantWrite(parsed.data.modelId, parsed.data.adapterConfig ?? undefined, parsed.data.paramLimits ?? undefined, {
    maxReferenceImages: parsed.data.maxReferenceImages,
    maxReferenceVideos: parsed.data.maxReferenceVideos,
    maxReferenceAudios: parsed.data.maxReferenceAudios,
    maxDuration: parsed.data.maxDuration,
  });
  if ("error" in validation) {
    return c.json({ error: { message: validation.error, code: validation.code } }, validation.status);
  }
  const [existing] = await db.select({ id: variants.id }).from(variants).where(eq(variants.name, parsed.data.name)).limit(1);
  if (existing) return c.json({ error: { message: `Variant name '${parsed.data.name}' already exists`, code: "variant_name_taken" } }, 409);
  const id = nanoid();
  await db.insert(variants).values({ id, name: parsed.data.name, modelId: parsed.data.modelId, description: parsed.data.description ?? null, adapterConfig: toStored(parsed.data.adapterConfig), paramOverrides: toStored(parsed.data.paramOverrides), paramBlocked: toStored(parsed.data.paramBlocked), fieldMapping: toStored(parsed.data.fieldMapping), paramLimits: toStored(parsed.data.paramLimits), maxContext: parsed.data.maxContext ?? null, maxOutput: parsed.data.maxOutput ?? null, maxImages: parsed.data.maxImages ?? null, maxReferenceImages: parsed.data.maxReferenceImages ?? null, maxReferenceVideos: parsed.data.maxReferenceVideos ?? null, maxReferenceAudios: parsed.data.maxReferenceAudios ?? null, maxDuration: parsed.data.maxDuration ?? null, maxAudioLen: parsed.data.maxAudioLen ?? null, isPublic: parsed.data.isPublic ?? 1 });
  await writeAudit({ actor: "admin", action: "variant.create", resourceType: "variant", resourceId: id, payload: JSON.stringify({ name: parsed.data.name, modelId: parsed.data.modelId }) });
  return c.json({ data: { id, ...parsed.data } }, 201);
});

variantsRoute.patch("/variants/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const parsed = VariantSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const [existing] = await db.select().from(variants).where(eq(variants.id, id)).limit(1);
  if (!existing) return c.json({ error: "Not found" }, 404);
  const targetModelId = parsed.data.modelId ?? existing.modelId;
  const validation = await validateVariantWrite(
    targetModelId,
    parsed.data.adapterConfig !== undefined
      ? parsed.data.adapterConfig ?? undefined
      : fromStoredObject(existing.adapterConfig),
    parsed.data.paramLimits !== undefined
      ? parsed.data.paramLimits ?? undefined
      : fromStoredParamLimits(existing.paramLimits),
    {
      maxReferenceImages: parsed.data.maxReferenceImages !== undefined ? parsed.data.maxReferenceImages : existing.maxReferenceImages,
      maxReferenceVideos: parsed.data.maxReferenceVideos !== undefined ? parsed.data.maxReferenceVideos : existing.maxReferenceVideos,
      maxReferenceAudios: parsed.data.maxReferenceAudios !== undefined ? parsed.data.maxReferenceAudios : existing.maxReferenceAudios,
      maxDuration: parsed.data.maxDuration !== undefined ? parsed.data.maxDuration : existing.maxDuration,
    },
  );
  if ("error" in validation) {
    return c.json({ error: { message: validation.error, code: validation.code } }, validation.status);
  }
  const update: Record<string, unknown> = { updatedAt: new Date() };
  for (const key of ["name", "description", "modelId", "maxContext", "maxOutput", "maxImages", "maxReferenceImages", "maxReferenceVideos", "maxReferenceAudios", "maxDuration", "maxAudioLen", "isPublic"] as const) if (parsed.data[key] !== undefined) update[key] = parsed.data[key];
  if (parsed.data.adapterConfig !== undefined) update.adapterConfig = toStored(parsed.data.adapterConfig);
  if (parsed.data.paramOverrides !== undefined) update.paramOverrides = toStored(parsed.data.paramOverrides);
  if (parsed.data.paramBlocked !== undefined) update.paramBlocked = toStored(parsed.data.paramBlocked);
  if (parsed.data.fieldMapping !== undefined) update.fieldMapping = toStored(parsed.data.fieldMapping);
  if (parsed.data.paramLimits !== undefined) update.paramLimits = toStored(parsed.data.paramLimits);
  try { const [row] = await db.update(variants).set(update).where(eq(variants.id, id)).returning(); if (!row) return c.json({ error: "Not found" }, 404); await writeAudit({ actor: "admin", action: "variant.update", resourceType: "variant", resourceId: id }); return c.json({ data: row }); } catch (error) { return c.json({ error: { message: error instanceof Error ? error.message : String(error) } }, 400); }
});

variantsRoute.delete("/variants/:id", async (c) => {
  const id = c.req.param("id");
  const keyRows = await db.select({ id: keys.id, allowedVariantIds: keys.allowedVariantIds }).from(keys);
  await Promise.all(keyRows.map(async (key) => { if (!key.allowedVariantIds) return; try { const allowed = JSON.parse(key.allowedVariantIds) as string[]; const next = allowed.filter((variantId) => variantId !== id); if (next.length !== allowed.length) await db.update(keys).set({ allowedVariantIds: JSON.stringify(next) }).where(eq(keys.id, key.id)); } catch { /* retain malformed legacy authorization data */ } }));
  await db.delete(variants).where(eq(variants.id, id));
  await writeAudit({ actor: "admin", action: "variant.delete", resourceType: "variant", resourceId: id });
  return c.json({ data: { id, deleted: true } });
});

export default variantsRoute;
