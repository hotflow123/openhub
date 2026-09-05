import { Hono } from "hono";
import { authMiddleware } from "../../middleware/auth";
import { eq } from "drizzle-orm";
import { db } from "../../db/index";
import { models, sites, variants } from "../../db/schema/index";
import { isExecutableVideoProtocol, resolveModelProtocol } from "../../engine/protocol-catalog";
import { assessPublication } from "../../engine/publication-policy";
import { resolveAdapterForModel } from "../../engine/adapter";

const v1Models = new Hono();

v1Models.use("/v1/models", authMiddleware);

/**
 * GET /v1/models
 *
 * 聚合所有站点的模型列表，以 variant 形式对外暴露。
 * 调用方用 variant name 作为 model 字段。
 */
v1Models.get("/v1/models", async (c) => {
  const hubKey = c.get("hubKey");
  const allVariants = await db
    .select()
    .from(variants)
    .where(eq(variants.isPublic, 1));
  const data = await Promise.all(
    allVariants
      .filter((variant) =>
        !hubKey.allowedVariantIds || hubKey.allowedVariantIds.includes(variant.id),
      )
      .map(async (v) => {
      const [modelRow] = await db
        .select()
        .from(models)
        .where(eq(models.id, v.modelId))
        .limit(1);
      const [site] = modelRow
        ? await db.select().from(sites).where(eq(sites.id, modelRow.siteId)).limit(1)
        : [undefined];
      if (!modelRow || site?.status !== "active") return null;
      const protocol = modelRow.modality === "video"
        ? await resolveModelProtocol(modelRow.id)
        : null;
      const resolved = resolveAdapterForModel(modelRow.adapterId, site.adapterId);
      const publication = assessPublication({
        siteActive: site.status === "active",
        modelStatus: modelRow.status,
        modality: modelRow.modality,
        adapterCapabilities: resolved?.adapter.capabilities ?? [],
        protocolReady: Boolean(
          protocol &&
          protocol.catalog.enabled &&
          protocol.catalog.status === "active" &&
          isExecutableVideoProtocol(protocol.document),
        ),
      });
      if (!publication.public) return null;
      return {
        id: v.name,
        object: "model",
        created: Math.floor(v.createdAt.getTime() / 1000),
        owned_by: site?.name ?? "unknown",
      };
      }),
  );
  return c.json({ object: "list", data: data.filter((item): item is NonNullable<typeof item> => item !== null) });
});

export default v1Models;
