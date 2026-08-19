import { registerAdapter, listAdapters } from "./adapter";
import { openaiAdapter } from "./adapters/openai";
import { klingAdapter } from "./adapters/kling";
import { wanAdapter } from "./adapters/wan";
import { seedanceAdapter } from "./adapters/seedance";
import { grokAdapter } from "./adapters/grok";

/**
 * 注册所有内置适配器
 */
export function bootstrapAdapters(): void {
  registerAdapter(openaiAdapter);
  registerAdapter(klingAdapter);
  registerAdapter(wanAdapter);
  registerAdapter(seedanceAdapter);
  registerAdapter(grokAdapter);
}

export { listAdapters };
export * from "./adapter";
