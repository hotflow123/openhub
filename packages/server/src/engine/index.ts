import { registerAdapter, listAdapters, wrapLegacyAdapter } from "./adapter";
import { openaiAdapter } from "./adapters/openai";
import { klingAdapter } from "./adapters/kling";
import { wanAdapter } from "./adapters/wan";
import { seedanceAdapter } from "./adapters/seedance";
import { grokAdapter } from "./adapters/grok";
import { memefastAdapter } from "./adapters/memefast";
import {
  builtinAdapterManifest,
  clearProviderAdapterRegistry,
  listProviderAdapterRegistrations,
  registerProviderAdapter,
} from "./adapter-manifest";

const builtInAdapters = [
  { adapter: openaiAdapter, sourcePath: "src/engine/adapters/openai.ts" },
  { adapter: klingAdapter, sourcePath: "src/engine/adapters/kling.ts" },
  { adapter: wanAdapter, sourcePath: "src/engine/adapters/wan.ts" },
  { adapter: seedanceAdapter, sourcePath: "src/engine/adapters/seedance.ts" },
  { adapter: grokAdapter, sourcePath: "src/engine/adapters/grok.ts" },
  { adapter: memefastAdapter, sourcePath: "src/engine/adapters/memefast.ts" },
] as const;

/**
 * 注册所有内置适配器
 */
export function bootstrapAdapters(): void {
  clearProviderAdapterRegistry();
  for (const entry of builtInAdapters) {
    registerAdapter(entry.adapter);
    registerProviderAdapter(
      wrapLegacyAdapter(entry.adapter, builtinAdapterManifest(entry.adapter.id)),
      { sourcePath: entry.sourcePath },
    );
  }
}

export { listAdapters };
export { listProviderAdapterRegistrations };
export * from "./adapter";
