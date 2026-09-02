import { bootstrapAdapters } from "../src/engine/index.js";
import {
  buildAdapterIndex,
  DEFAULT_ADAPTER_INDEX_PATH,
  readAdapterIndex,
  validateAdapterIndex,
  writeAdapterIndex,
} from "../src/engine/adapter-index.js";

const command = process.argv[2] ?? "check";

bootstrapAdapters();
const generated = await buildAdapterIndex();

if (command === "generate") {
  await writeAdapterIndex(generated);
  console.log(`[openhub] adapter index written: ${DEFAULT_ADAPTER_INDEX_PATH}`);
  process.exit(0);
}

if (command !== "check") {
  console.error("Usage: tsx scripts/adapter-index.ts <generate|check>");
  process.exit(2);
}

try {
  const current = await readAdapterIndex();
  const result = validateAdapterIndex(current, generated);
  if (!result.ok) {
    console.error("[openhub] adapter index check failed:");
    for (const issue of result.issues) console.error(`- ${issue}`);
    process.exit(1);
  }
  console.log("[openhub] adapter index is current");
} catch (error) {
  console.error("[openhub] adapter index check failed: index is missing or invalid");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
