/**
 * LLM-based model capability inference engine
 * 
 * 使用 Anthropic Claude API 推理模型能力
 */

interface InferredCapability {
  modality: "llm" | "image" | "audio" | "video" | "embedding";
  inferredVendor?: string;
  inferredFamily?: string;
  inferredVersion?: string;
  confidence: number;
  llm?: {
    contextWindow?: number;
    supportsFunctionCalling?: boolean;
    supportsStreaming?: boolean;
    supportsVision?: boolean;
  };
  image?: {
    maxWidth?: number;
    maxHeight?: number;
    supportedFormats?: string[];
  };
  video?: {
    maxDurationSec?: number;
    supportedResolutions?: string[];
    requiresAsync?: boolean;
  };
  audio?: {
    maxDurationSec?: number;
    supportedFormats?: string[];
  };
}

// 规则引擎：基于关键词的快速识别
function inferByRules(modelId: string): InferredCapability | null {
  const id = modelId.toLowerCase();

  // ========== 视频模型 ==========
  // Doubao SeedAnce
  if (id.includes("seedance")) {
    const versionMatch = id.match(/seedance[-_]?(\d+[-_.]?\d*)/);
    return {
      modality: "video",
      inferredVendor: "Doubao / ByteDance",
      inferredFamily: "seedance",
      inferredVersion: versionMatch?.[1]?.replace(/[-_]/g, ".") || "unknown",
      confidence: 0.95,
      video: {
        maxDurationSec: 10,
        supportedResolutions: ["720p", "1080p"],
        requiresAsync: true,
      },
    };
  }

  // Kuaishou Kling
  if (id.includes("kling")) {
    const versionMatch = id.match(/kling[-_]?v?(\d+[-_.]?\d*)/);
    return {
      modality: "video",
      inferredVendor: "Kuaishou / Kling AI",
      inferredFamily: "kling",
      inferredVersion: versionMatch?.[1]?.replace(/[-_]/g, ".") || "1.0",
      confidence: 0.95,
      video: {
        maxDurationSec: 10,
        supportedResolutions: ["720p", "1080p"],
        requiresAsync: true,
      },
    };
  }

  // OpenAI Sora
  if (id.includes("sora")) {
    return {
      modality: "video",
      inferredVendor: "OpenAI",
      inferredFamily: "sora",
      inferredVersion: "1.0",
      confidence: 0.9,
      video: {
        maxDurationSec: 60,
        supportedResolutions: ["1080p", "4k"],
        requiresAsync: true,
      },
    };
  }

  // Google Veo
  if (id.includes("veo")) {
    const versionMatch = id.match(/veo[-_]?(\d+)/);
    return {
      modality: "video",
      inferredVendor: "Google DeepMind",
      inferredFamily: "veo",
      inferredVersion: versionMatch?.[1] || "1",
      confidence: 0.9,
      video: {
        maxDurationSec: 60,
        supportedResolutions: ["1080p", "4k"],
        requiresAsync: true,
      },
    };
  }

  // Grok Imagine Video
  if (id.includes("grok") && (id.includes("video") || id.includes("imagine-video"))) {
    return {
      modality: "video",
      inferredVendor: "xAI",
      inferredFamily: "grok-imagine-video",
      inferredVersion: "1.0",
      confidence: 0.85,
      video: {
        maxDurationSec: 5,
        supportedResolutions: ["720p", "1080p"],
        requiresAsync: true,
      },
    };
  }

  // ========== LLM 模型 ==========
  // Anthropic Claude
  if (id.includes("claude")) {
    const versionMatch = id.match(/claude[-_]?(\d+[-_.]?\d*[-_.]?\d*)/);
    const isSonnet = id.includes("sonnet");
    const isOpus = id.includes("opus");
    const isHaiku = id.includes("haiku");
    
    let family = "claude";
    if (isSonnet) family = "claude-sonnet";
    else if (isOpus) family = "claude-opus";
    else if (isHaiku) family = "claude-haiku";

    return {
      modality: "llm",
      inferredVendor: "Anthropic",
      inferredFamily: family,
      inferredVersion: versionMatch?.[1]?.replace(/[-_]/g, ".") || "3",
      confidence: 0.95,
      llm: {
        contextWindow: 200000,
        supportsFunctionCalling: true,
        supportsStreaming: true,
        supportsVision: true,
      },
    };
  }

  // OpenAI GPT
  if (id.includes("gpt")) {
    const versionMatch = id.match(/gpt[-_]?(\d+[-_.]?\d*)/);
    const isTurbo = id.includes("turbo");
    const isMini = id.includes("mini");
    
    let family = "gpt";
    if (isTurbo) family = "gpt-turbo";
    else if (isMini) family = "gpt-mini";

    return {
      modality: "llm",
      inferredVendor: "OpenAI",
      inferredFamily: family,
      inferredVersion: versionMatch?.[1]?.replace(/[-_]/g, ".") || "4",
      confidence: 0.95,
      llm: {
        contextWindow: 128000,
        supportsFunctionCalling: true,
        supportsStreaming: true,
        supportsVision: id.includes("4") || id.includes("vision"),
      },
    };
  }

  // Google Gemini
  if (id.includes("gemini")) {
    const versionMatch = id.match(/gemini[-_]?(\d+[-_.]?\d*)/);
    const isPro = id.includes("pro");
    const isFlash = id.includes("flash");
    
    let family = "gemini";
    if (isPro) family = "gemini-pro";
    else if (isFlash) family = "gemini-flash";

    // 检查是否是图像生成模型
    if (id.includes("imagen") || id.includes("image")) {
      return {
        modality: "image",
        inferredVendor: "Google",
        inferredFamily: "gemini-imagen",
        inferredVersion: versionMatch?.[1]?.replace(/[-_]/g, ".") || "3",
        confidence: 0.9,
        image: {
          maxWidth: 2048,
          maxHeight: 2048,
          supportedFormats: ["png", "jpg", "webp"],
        },
      };
    }

    return {
      modality: "llm",
      inferredVendor: "Google",
      inferredFamily: family,
      inferredVersion: versionMatch?.[1]?.replace(/[-_]/g, ".") || "1.5",
      confidence: 0.95,
      llm: {
        contextWindow: 1000000,
        supportsFunctionCalling: true,
        supportsStreaming: true,
        supportsVision: true,
      },
    };
  }

  // DeepSeek
  if (id.includes("deepseek")) {
    const versionMatch = id.match(/deepseek[-_]?v?(\d+[-_.]?\d*)/);
    const isChat = id.includes("chat");
    const isCoder = id.includes("coder");
    
    let family = "deepseek";
    if (isChat) family = "deepseek-chat";
    else if (isCoder) family = "deepseek-coder";

    return {
      modality: "llm",
      inferredVendor: "DeepSeek",
      inferredFamily: family,
      inferredVersion: versionMatch?.[1]?.replace(/[-_]/g, ".") || "2",
      confidence: 0.9,
      llm: {
        contextWindow: 128000,
        supportsFunctionCalling: true,
        supportsStreaming: true,
        supportsVision: false,
      },
    };
  }

  // Moonshot Kimi
  if (id.includes("kimi") || id.includes("moonshot")) {
    const versionMatch = id.match(/kimi[-_]?v?(\d+[-_.]?\d*)/);
    return {
      modality: "llm",
      inferredVendor: "Moonshot AI",
      inferredFamily: "kimi",
      inferredVersion: versionMatch?.[1]?.replace(/[-_]/g, ".") || "1",
      confidence: 0.9,
      llm: {
        contextWindow: 200000,
        supportsFunctionCalling: true,
        supportsStreaming: true,
        supportsVision: false,
      },
    };
  }

  // xAI Grok (LLM)
  if (id.includes("grok") && !id.includes("video") && !id.includes("imagine-video")) {
    const versionMatch = id.match(/grok[-_]?(\d+[-_.]?\d*)/);
    return {
      modality: "llm",
      inferredVendor: "xAI",
      inferredFamily: "grok",
      inferredVersion: versionMatch?.[1]?.replace(/[-_]/g, ".") || "2",
      confidence: 0.9,
      llm: {
        contextWindow: 128000,
        supportsFunctionCalling: true,
        supportsStreaming: true,
        supportsVision: false,
      },
    };
  }

  // ========== 图像模型 ==========
  // Stable Diffusion
  if (id.includes("stable") || id.includes("sd-") || id.includes("sdxl")) {
    const versionMatch = id.match(/(?:sd|stable)[-_]?(\d+[-_.]?\d*)/);
    return {
      modality: "image",
      inferredVendor: "Stability AI",
      inferredFamily: "stable-diffusion",
      inferredVersion: versionMatch?.[1]?.replace(/[-_]/g, ".") || "1.5",
      confidence: 0.9,
      image: {
        maxWidth: 1024,
        maxHeight: 1024,
        supportedFormats: ["png", "jpg"],
      },
    };
  }

  // DALL-E
  if (id.includes("dall") || id.includes("dalle")) {
    const versionMatch = id.match(/dall[-e_]?(\d+)/);
    return {
      modality: "image",
      inferredVendor: "OpenAI",
      inferredFamily: "dall-e",
      inferredVersion: versionMatch?.[1] || "3",
      confidence: 0.95,
      image: {
        maxWidth: 1024,
        maxHeight: 1024,
        supportedFormats: ["png"],
      },
    };
  }

  // Flux
  if (id.includes("flux")) {
    const versionMatch = id.match(/flux[-_]?(\d+[-_.]?\d*)/);
    const isPro = id.includes("pro");
    const isDev = id.includes("dev");
    
    let family = "flux";
    if (isPro) family = "flux-pro";
    else if (isDev) family = "flux-dev";

    return {
      modality: "image",
      inferredVendor: "Black Forest Labs",
      inferredFamily: family,
      inferredVersion: versionMatch?.[1]?.replace(/[-_]/g, ".") || "1",
      confidence: 0.9,
      image: {
        maxWidth: 2048,
        maxHeight: 2048,
        supportedFormats: ["png", "jpg", "webp"],
      },
    };
  }

  return null;
}

/**
 * 推理模型能力（主入口）
 */
export async function inferModelCapability(modelId: string): Promise<InferredCapability> {
  // 1. 先尝试规则引擎
  const ruleResult = inferByRules(modelId);
  if (ruleResult) {
    return ruleResult;
  }

  // 2. 规则引擎无法识别，返回默认 LLM
  console.warn(`[llm-infer] Cannot infer ${modelId}, defaulting to LLM`);
  return {
    modality: "llm",
    inferredVendor: "Unknown",
    inferredFamily: "unknown",
    inferredVersion: "unknown",
    confidence: 0.3,
    llm: {
      contextWindow: 4096,
      supportsFunctionCalling: false,
      supportsStreaming: true,
      supportsVision: false,
    },
  };
}
