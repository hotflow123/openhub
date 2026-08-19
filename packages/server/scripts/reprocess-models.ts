/**
 * 一次性脚本：重新处理所有现有模型的视频参数
 * 从 fal.ai schema 提取 duration/resolution/aspect_ratio 枚举值
 * 运行: pnpm tsx scripts/reprocess-models.ts
 */
import { db } from "../src/db/index";
import { models } from "../src/db/schema/index";
import { eq } from "drizzle-orm";
import { inferModelCapability } from "../src/engine/infer";

async function main() {
  const rows = await db.select().from(models);
  console.log(`Processing ${rows.length} models...`);

  let updated = 0;
  let skipped = 0;

  for (const model of rows) {
    try {
      const inferred = await inferModelCapability(model.rawName, {
        schemaEndpointId: model.schemaEndpointId,
      });

      // Extract video enums from parameters array — same logic as discover.ts
      const params = inferred.parameters ?? [];

      const durationParam = params.find((p) => p.name === "duration");
      const resolutionParam = params.find((p) => p.name === "resolution");
      const aspectRatioParam = params.find((p) => p.name === "aspect_ratio");
      const generateAudioParam = params.find((p) => p.name === "generate_audio");
      const maxDurationParam = params.find((p) => p.name === "max_duration");

      let videoDurationEnum: string | null = null;
      let videoResolutions: string | null = null;
      let videoAspectRatios: string | null = null;
      let generateAudioSupported = 0;
      let maxDurationSec: number | null = null;

      if (durationParam?.enum && Array.isArray(durationParam.enum)) {
        const nums = durationParam.enum
          .map((v) => Number(v))
          .filter((n) => Number.isFinite(n) && n > 0);
        if (nums.length > 0) {
          videoDurationEnum = JSON.stringify(durationParam.enum.map(String));
          maxDurationSec = Math.max(...nums);
        }
      }

      if (resolutionParam?.enum && Array.isArray(resolutionParam.enum)) {
        videoResolutions = JSON.stringify(resolutionParam.enum.map(String));
      }

      if (aspectRatioParam?.enum && Array.isArray(aspectRatioParam.enum)) {
        videoAspectRatios = JSON.stringify(aspectRatioParam.enum.map(String));
      }

      if (generateAudioParam !== undefined) {
        if (typeof generateAudioParam.default === "boolean") {
          generateAudioSupported = generateAudioParam.default ? 1 : 0;
        }
      }

      const falParametersSnapshot = inferred.parameters?.length
        ? JSON.stringify(inferred.parameters)
        : model.falParametersSnapshot;

      const needsUpdate =
        videoDurationEnum !== model.videoDurationEnum ||
        videoResolutions !== model.videoResolutions ||
        videoAspectRatios !== model.videoAspectRatios ||
        generateAudioSupported !== model.generateAudioSupported ||
        maxDurationSec !== model.maxDurationSec ||
        falParametersSnapshot !== model.falParametersSnapshot;

      if (needsUpdate) {
        await db
          .update(models)
          .set({
            videoDurationEnum,
            videoResolutions,
            videoAspectRatios,
            generateAudioSupported,
            maxDurationSec,
            falParametersSnapshot,
            schemaEndpointId: model.schemaEndpointId,
            schemaMatchSource: model.schemaMatchSource,
          })
          .where(eq(models.id, model.id));
        console.log(
          `  [UPDATED] ${model.rawName}: duration=${videoDurationEnum ? "has" : "null"}, ` +
            `res=${videoResolutions ? "has" : "null"}, ` +
            `aspect=${videoAspectRatios ? "has" : "null"}, ` +
            `audio=${generateAudioSupported}, maxSec=${maxDurationSec}`
        );
        updated++;
      } else {
        skipped++;
      }
    } catch (err) {
      console.warn(`  [SKIP] ${model.rawName}: infer failed -`, err);
    }
  }

  console.log(`\nDone: ${updated} updated, ${skipped} unchanged, ${rows.length - updated - skipped} failed`);
}

main().catch(console.error);
