import Database from "better-sqlite3";
import { extractInputSchemaCapabilities } from "../src/lib/fal-input-schema.js";

const db = new Database("./data/openhub.db", { readonly: true });

try {
  const schema = db
    .prepare(
      "select input_schema, parameters from model_schema_catalog where endpoint_id = ?",
    )
    .get("bytedance/seedance-2.0/reference-to-video") as
    | { input_schema: string | null; parameters: string | null }
    | undefined;
  if (!schema) throw new Error("Seedance reference-to-video schema is missing");

  const caps = extractInputSchemaCapabilities(schema.input_schema, schema.parameters);
  const expected = { images: 9, videos: 3, audios: 3 };
  if (
    caps.maxReferenceImages !== expected.images ||
    caps.maxReferenceVideos !== expected.videos ||
    caps.maxReferenceAudios !== expected.audios
  ) {
    throw new Error(`Unexpected Schema capabilities: ${JSON.stringify(caps)}`);
  }

  const model = db
    .prepare(
      "select max_reference_images, max_reference_videos, max_reference_audios from models where raw_name = ?",
    )
    .get("seedance2.0-S") as
    | {
        max_reference_images: number | null;
        max_reference_videos: number | null;
        max_reference_audios: number | null;
      }
    | undefined;
  if (
    !model ||
    model.max_reference_images !== expected.images ||
    model.max_reference_videos !== expected.videos ||
    model.max_reference_audios !== expected.audios
  ) {
    throw new Error(`Model backfill is incomplete: ${JSON.stringify(model)}`);
  }

  const variantColumns = new Set(
    db.prepare("pragma table_info(variants)").all().map((row: { name: string }) => row.name),
  );
  for (const column of [
    "max_reference_images",
    "max_reference_videos",
    "max_reference_audios",
  ]) {
    if (!variantColumns.has(column)) throw new Error(`Missing variants.${column}`);
  }

  console.log("Fal reference capability verification passed: 9 images, 3 videos, 3 audios.");
} finally {
  db.close();
}
