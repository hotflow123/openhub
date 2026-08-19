/**
 * 保守迁移：用已有 schemaEndpointId 回填 Fal 快照和规范化参考资源上限。
 *
 * 用法：node --import=tsx src/scripts/fill-schema-snapshot.ts
 */
import { eq, isNotNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { models, modelSchemaCatalog } from "../db/schema/index.js";
import { extractInputSchemaCapabilities } from "../lib/fal-input-schema.js";

async function main() {
  console.log("=== 填入 falInputSchemaSnapshot（保守迁移）===\n");

  const rows = await db
    .select({
      modelId: models.id,
      rawName: models.rawName,
      schemaEndpointId: models.schemaEndpointId,
    })
    .from(models)
    .where(isNotNull(models.schemaEndpointId));

  const withSchema = rows.filter(r => r.schemaEndpointId != null);
  console.log(`已有 schemaEndpointId 的模型: ${withSchema.length}`);

  let updated = 0;
  let notFound = 0;

  for (const row of withSchema) {
    if (!row.schemaEndpointId) continue;
    const [schema] = await db
      .select({ inputSchema: modelSchemaCatalog.inputSchema, parameters: modelSchemaCatalog.parameters })
      .from(modelSchemaCatalog)
      .where(eq(modelSchemaCatalog.endpointId, row.schemaEndpointId))
      .limit(1);

    if (!schema) {
      console.log(`  ⚠️  ${row.rawName}: schema ${row.schemaEndpointId} 未找到`);
      notFound++;
      continue;
    }

    if (!schema.inputSchema) {
      console.log(`  ⚠️  ${row.rawName}: schema ${row.schemaEndpointId} 无 inputSchema`);
      notFound++;
      continue;
    }

    const caps = extractInputSchemaCapabilities(schema.inputSchema, schema.parameters ?? null);

    await db
      .update(models)
      .set({
        falInputSchemaSnapshot: schema.inputSchema,
        falParametersSnapshot: schema.parameters ?? null,
        maxReferenceImages: caps.maxReferenceImages,
        maxReferenceVideos: caps.maxReferenceVideos,
        maxReferenceAudios: caps.maxReferenceAudios,
        updatedAt: new Date(),
      })
      .where(eq(models.id, row.modelId));

    updated++;
    if (caps.maxReferenceImages != null || caps.maxReferenceVideos != null || caps.maxReferenceAudios != null) {
      console.log(
        `  ✅ ${row.rawName} (${row.schemaEndpointId}): ` +
        `images=${caps.maxReferenceImages ?? '-'} videos=${caps.maxReferenceVideos ?? '-'} audios=${caps.maxReferenceAudios ?? '-'}`,
      );
    } else {
      console.log(`  ✅ ${row.rawName} (${row.schemaEndpointId}): 无参考资源参数`);
    }
  }

  console.log(`\n完成：更新 ${updated}，未找到 schema ${notFound}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
