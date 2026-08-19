/**
 * Adapted from anomalyco/models.dev (MIT License).
 * https://github.com/anomalyco/models.dev/blob/dev/packages/core/src/family.ts
 */

/** family 枚举 —— 上游维护的社区共识列表 */
export const ModelFamilyValues = [
  // OpenAI / GPT
  "gpt", "gpt-codex", "gpt-codex-spark", "gpt-codex-mini",
  "gpt-pro", "gpt-mini", "gpt-nano", "gpt-sol", "gpt-terra",
  "gpt-luna", "gpt-oss", "gpt-image",
  "o", "o-mini", "o-pro",

  // Anthropic
  "claude", "claude-haiku", "claude-sonnet", "claude-opus",
  "claude-fable", "claude-mythos",

  // Gemini
  "gemini", "gemini-pro", "gemini-flash", "gemini-flash-lite",
  "gemini-embedding",

  // GLM (Zhipu)
  "glm", "glmv", "glm-air", "glm-flash", "glm-free", "glm-z",

  // Meta
  "llama", "muse",

  // Alibaba Qwen
  "qwen", "qwen3.5", "qwen3.6", "qwen3.7-plus", "qwen3.7-max",
  "qwen3.8-max", "qwen-free",

  // DeepSeek
  "deepseek", "deepseek-thinking", "deepseek-flash",
  "deepseek-flash-free", "deepseek-flash-think",

  // Microsoft
  "phi",

  // Moonshot Kimi
  "kimi", "kimi-k2", "kimi-k3", "kimi-free", "kimi-thinking",

  // Mistral
  "mistral", "mistral-large", "mistral-medium", "mistral-small",
  "mistral-nemo", "ministral", "codestral", "devstral",
  "pixtral", "mixtral",

  // xAI
  "grok", "grok-build", "grok-vision", "grok-beta",

  // Google
  "gemma",

  // AWS
  "nova", "nova-pro", "nova-lite", "nova-micro",

  // Cohere
  "command", "command-r", "command-a", "command-light",
  "north", "north-free",

  // NVIDIA
  "nemotron", "nemotron-free",

  // Other
  "hunyuan", "yi", "granite",

  // Sonar (Perplexity)
  "sonar", "sonar-pro", "sonar-reasoning", "sonar-deep-research",

  // Image
  "dall-e", "flux", "imagen", "recraft",
  "stable-diffusion", "ideogram", "dreamshaper",

  // Video
  "sora", "veo", "runway", "dream-machine",

  // Audio
  "whisper", "elevenlabs", "lyria", "melotts",

  // Embedding
  "text-embedding", "cohere-embed", "voyage",
  "mistral-embed", "bge", "plamo", "codestral-embed",
] as const;

/**
 * Adapted from anomalyco/models.dev (MIT License).
 * 模型名变体归一化示例：处理 kimi-k2 / kimi_k2 / kimi k2 等拼写差异
 */
export function inferKimiFamily(...values: string[]): string | undefined {
  const target = values.join(" ").toLowerCase();
  if (/kimi[^a-z0-9]*k2(?:[^a-z0-9]*\d+)?[^a-z0-9]*thinking/.test(target)) return "kimi-thinking";
  if (/kimi[\s_-]*k2/.test(target)) return "kimi-k2";
  if (/kimi[\s_-]*k3/.test(target)) return "kimi-k3";
  return undefined;
}