import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../../db/index";
import { models, sites, variants } from "../../db/schema/index";

const v1Models = new Hono();

/**
 * GET /v1/models
 *
 * 聚合所有站点的模型列表，以 variant 形式对外暴露。
 * 调用方用 variant name 作为 model 字段。
 */
v1Models.get("/v1/models", async (c) => {
  const allVariants = await db.select().from(variants);
  const data = await Promise.all(
    allVariants.map(async (v) => {
      const [modelRow] = await db
        .select()
        .from(models)
        .where(eq(models.id, v.modelId))
        .limit(1);
      const [site] = modelRow
        ? await db.select().from(sites).where(eq(sites.id, modelRow.siteId)).limit(1)
        : [undefined];
      return {
        id: v.name,
        object: "model",
        created: Math.floor(v.createdAt.getTime() / 1000),
        owned_by: site?.name ?? "unknown",
      };
    }),
  );
  return c.json({ object: "list", data });
});

export default v1Models;
