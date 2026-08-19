/**
 * 参数映射管线（DESIGN.md 第 9 章）
 *
 * 唯一正典执行顺序：
 *   1. 能力校验（请求发出前）
 *   2. 移除 param_blocked（变体级，原始字段名）
 *   3. 合并 param_defaults（适配器级，未设置字段才填充）
 *   4. 应用 param_overrides（变体级，强制覆盖）
 *   5. 固定值注入（适配器级 fixedParams，无条件覆盖）
 *   6. 字段重命名（variant.field_mapping，按重命名后匹配）
 *   7. 值转换（adapter.transforms）
 *   8. 未知参数处理（默认丢弃；provider_options 由 adapter 解包）
 *
 * 重要边界：
 *   - "未设置" = JSON.parse 后 hasOwnProperty 为 false
 *   - null/false/0/"" 都视为"已设置"，不触发默认值
 *   - param_blocked + param_overrides 同名：先删再注入，最终存在
 *   - field_mapping 与 param_blocked 不冲突（rename 在前）
 */

export interface VariantMappingConfig {
  /** 强制覆盖（无论调用方传什么，都用这些值） */
  param_overrides?: Record<string, unknown>;
  /** 禁止使用的参数名列表（OpenHub 字段名） */
  param_blocked?: string[];
  /** 字段名映射 { Hub字段: 站点字段 } */
  field_mapping?: Record<string, string>;
  /** 适配器特定配置（含 fixedParams / transforms 等） */
  adapter_config?: Record<string, unknown>;
}

export interface AdapterMappingConfig {
  /** 默认参数（仅未设置字段填充） */
  param_defaults?: Record<string, unknown>;
  /** 站点要求强制注入的字段（无条件覆盖） */
  fixedParams?: Record<string, unknown>;
  /** 字段值转换规则（按重命名后字段名匹配） */
  transforms?: FieldTransforms;
  /** 调用方透传的供应商扩展字段，由 adapter 解包 */
  unpackProviderOptions?: (params: Record<string, unknown>) => Record<string, unknown>;
  /** 已知标准字段白名单；未列出且非 provider_options 一律丢弃 */
  knownFields?: string[];
}

export type FieldTransform =
  | { type: "array_to_string"; separator?: string }
  | { type: "parse_dimensions" }
  | { type: "extract_type" }
  | { type: "rename_value"; map: Record<string, string> }
  | { type: "custom"; fn: (value: unknown) => unknown };

export type FieldTransforms = Record<string, FieldTransform>;

export interface ParamMapperInput {
  /** 调用方原始 body（已 JSON.parse，可能包含 provider_options） */
  callerBody: Record<string, unknown>;
  variant: VariantMappingConfig;
  adapter: AdapterMappingConfig;
}

export interface ParamMapperOutput {
  /** 站点请求 body */
  body: Record<string, unknown>;
  /** 被丢弃的字段（用于审计） */
  dropped: string[];
}

/**
 * 已知 OpenAI 标准字段（用于 Step 8 兜底白名单）。
 *
 * 这里只列出 chat completions 的常见字段。多模态路由调用本函数时，
 * 应当按 modality 提供更宽的白名单，或直接传 knownFields=undefined
 * 表示"全保留"（用于 adapter 自身负责过滤的场景）。
 */
export const CHAT_KNOWN_FIELDS: ReadonlySet<string> = new Set([
  "model",
  "messages",
  "prompt",
  "stream",
  "temperature",
  "top_p",
  "n",
  "max_tokens",
  "max_completion_tokens",
  "stop",
  "presence_penalty",
  "frequency_penalty",
  "logit_bias",
  "logprobs",
  "top_logprobs",
  "user",
  "response_format",
  "seed",
  "tools",
  "tool_choice",
  "parallel_tool_calls",
  "modalities",
  "audio",
  "prediction",
  "reasoning_effort",
  "service_tier",
  "store",
  "metadata",
  // image
  "size",
  "quality",
  "style",
  "response_format_image",
  // audio
  "input",
  "voice",
  "speed",
  // video
  "duration",
  "aspect_ratio",
  "reference_image_url",
  "callback_url",
  "callback_secret",
  "idempotency_key",
  // 通用透传容器
  "provider_options",
]);

const RESERVED_TOP_LEVEL = new Set(["provider_options"]);

export function mapParams(input: ParamMapperInput): ParamMapperOutput {
  const { callerBody, variant, adapter } = input;

  const out: Record<string, unknown> = {};
  const dropped: string[] = [];

  // 先把 provider_options 单独挑出来，最后再由 adapter 解包
  const providerOptions =
    callerBody && typeof callerBody === "object" && "provider_options" in callerBody
      ? (callerBody as Record<string, unknown>)["provider_options"]
      : undefined;

  // Step 2 — 移除 param_blocked
  const blocked = new Set(variant.param_blocked ?? []);
  for (const [k, v] of Object.entries(callerBody)) {
    if (blocked.has(k)) continue;
    out[k] = v;
  }

  // Step 3 — 合并 param_defaults（未设置字段才填）
  const defaults = adapter.param_defaults ?? {};
  for (const [k, v] of Object.entries(defaults)) {
    if (!Object.prototype.hasOwnProperty.call(out, k)) {
      out[k] = v;
    }
  }

  // Step 4 — 应用 param_overrides（无条件覆盖）
  const overrides = variant.param_overrides ?? {};
  for (const [k, v] of Object.entries(overrides)) {
    out[k] = v;
  }

  // Step 5 — 固定值注入（站点必须字段）
  const fixed = adapter.fixedParams ?? {};
  for (const [k, v] of Object.entries(fixed)) {
    out[k] = v;
  }

  // Step 6 — 字段重命名（rename 后字段名变为站点侧）
  const mapping = variant.field_mapping ?? {};
  const renamed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(out)) {
    const newKey = mapping[k] ?? k;
    renamed[newKey] = v;
  }

  // Step 7 — 值转换（按重命名后字段名匹配）
  const transforms = adapter.transforms ?? {};
  for (const [k, v] of Object.entries(renamed)) {
    const t = transforms[k];
    if (!t) {
      renamed[k] = v;
      continue;
    }
    renamed[k] = applyTransform(t, v);
  }

  // Step 8 — 未知参数处理
  const known = adapter.knownFields ? new Set(adapter.knownFields) : CHAT_KNOWN_FIELDS;
  const filtered: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(renamed)) {
    if (known.has(k) || RESERVED_TOP_LEVEL.has(k)) {
      filtered[k] = v;
    } else {
      dropped.push(k);
    }
  }

  // 8.b — provider_options 解包
  if (providerOptions && adapter.unpackProviderOptions) {
    const unpacked = adapter.unpackProviderOptions(
      providerOptions as Record<string, unknown>,
    );
    for (const [k, v] of Object.entries(unpacked)) {
      // 解包后的字段同样需要经过 knownFields 校验
      if (known.has(k)) {
        filtered[k] = v;
      } else {
        dropped.push(`provider_options.${k}`);
      }
    }
  }

  // 删除 provider_options 容器本身
  delete filtered["provider_options"];

  return { body: filtered, dropped };
}

function applyTransform(t: FieldTransform, value: unknown): unknown {
  switch (t.type) {
    case "array_to_string":
      if (Array.isArray(value)) return value.join(t.separator ?? ",");
      return value;
    case "parse_dimensions": {
      if (typeof value !== "string") return value;
      const m = value.match(/^(\d+)\s*[x×]\s*(\d+)$/i);
      if (!m) return value;
      return { width: Number(m[1]), height: Number(m[2]) };
    }
    case "extract_type": {
      if (value && typeof value === "object" && "type" in (value as object)) {
        return (value as { type: unknown }).type;
      }
      return value;
    }
    case "rename_value":
      if (typeof value === "string" && t.map[value]) return t.map[value];
      return value;
    case "custom":
      return t.fn(value);
  }
}
