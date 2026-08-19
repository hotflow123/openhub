# OpenHub 设计文档

> 本文档面向执行者，包含完整技术决策、数据模型、API 设计、能力识别、适配器系统、外部模型目录集成及风险说明。
> 执行前请先阅读"未验证假设"和"待确认问题"两节。

---

## 目录

1. [项目定位](#1-项目定位)
2. [核心概念](#2-核心概念)
3. [技术选型](#3-技术选型)
4. [系统架构](#4-系统架构)
5. [能力识别引擎](#5-能力识别引擎)
6. [适配器系统](#6-适配器系统)
7. [数据模型](#7-数据模型)
8. [变体系统](#8-变体系统)
9. [参数映射配置](#9-参数映射配置)
10. [API 设计](#10-api-设计)
11. [安全设计](#11-安全设计)
12. [UI 设计原则](#12-ui-设计原则)
13. [异步任务处理](#13-异步任务处理)
14. [边界条件与风险](#14-边界条件与风险)
15. [已确认 / 推测 / 未验证](#15-已确认--推测--未验证)
16. [待确认问题](#16-待确认问题)
17. [实施路线图](#17-实施路线图)
18. [模型引导配置向导](#18-模型引导配置向导)
19. [外部模型目录同步机制](#19-外部模型目录同步机制)
20. [上游源码复用清单](#20-上游源码复用清单)

---

## 1. 项目定位

### 一句话定位

面向 New API 使用者的**多站点、多模态模型自动适配与统一调用平台**。

### 链路

```
软件或网站（OpenAI SDK）
  ↓ 填写 baseURL + OpenHub API Key
OpenHub
  ↓ 填写 New API 地址 + Key，自动发现模型
多个 New API 站点
  ↓
上游模型供应商（OpenAI、Anthropic、Stability、通义、文心、Sora、Kling...）
```

### 解决的问题

开发者在使用 New API 站点时面临以下痛苦：

| 痛点 | OpenHub 的解决方案 |
|---|---|
| 每个站点的模型名称不同 | 自动发现 + 标准化模型列表 |
| 参数名称、类型、限制不同 | 参数适配层，映射为统一格式 |
| 图片/视频/音频接口调用方式不同 | 适配器系统，统一转发 |
| 异步任务（视频）需要轮询和回调 | 后台任务管理，统一查询接口 |
| 同名模型在不同站点能力不同 | 按站点独立存储模型能力数据 |
| 需要逐个站点对接 | 添加地址和 Key 后自动适配，马上可用 |

### 核心价值

> **添加一个 New API 地址和 Key → 自动发现模型 → 建立适配关系 → 生成统一调用入口**

上层软件不需要知道调的是哪个站点、哪个供应商、哪个模型版本。

### 产品边界

- **不是** New API 的替代品或聚合平台。
- **不是** 模型交易市场（不涉及计费、分成）。
- **不是** 模型训练平台。
- **不是** 单纯的模型目录展示站。
- **是** 位于应用与 New API 实例之间的**可执行的模型适配层**。

---

## 2. 核心概念

### 站点（Site）

一个 New API 实例。包含：
- 地址（base_url）
- API Key（加密存储）
- 连接状态
- 支持的模型列表（动态发现）

### 模型（Model）

**注意**：模型在 OpenHub 中有严格的两层含义：

1. **供应商模型**（Vendor Model）：上游供应商发布的模型版本，如 `gpt-4o-2024-08-06`、`claude-3-5-sonnet-20240620`。同一供应商模型名在不同站点相同。
2. **站点模型实例**（Site Model Instance）：同一个供应商模型在不同 New API 站点上的独立实例。可能存在能力差异（量化版、阉割版、完整版）。

OpenHub 的 `models` 表存储的是**站点模型实例**，不是供应商模型。同一供应商模型在不同站点是独立记录。

### 能力（Capability）

模型支持的**功能标签**，不是能力值。例如：
- `chat` — 对话
- `vision` — 图片理解
- `function_calling` — 工具调用
- `json_mode` — 结构化输出
- `image_generation` — 图片生成
- `image_editing` — 图片编辑
- `tts` — 语音合成
- `stt` — 语音转写
- `video_generation` — 视频生成
- `video_editing` — 视频编辑

一个模型可以有多个能力标签。

### 变体（Variant）

在站点模型实例基础上封装的**业务适配版本**，是调用方实际使用的调用单位。

变体定义了：
- 调用时使用的模型名（对外暴露，如 `my-gpt4-fast`）
- 默认参数
- 参数限制
- 字段映射规则

调用方不需要知道底层的站点、模型版本、参数名称差异，只需要指定变体名。

### 模型目录（Model Catalog）

OpenHub 内部维护的**外部官方模型知识库镜像**，数据来源为 [models.dev](https://models.dev) 开源目录。

目录记录的是**模型本身的规范事实**（provider-agnostic），而不是某个站点的服务细节：

- 规范 ID（如 `openai/gpt-5`）、可读名称、model family
- 输入/输出 modality（text、image、audio、video、pdf）
- 能力标志：`attachment`、`reasoning`、`tool_call`、`structured_output`、`temperature`
- 默认限制：`context`、`input`、`output` token 上限
- 关联的厂商（lab）信息

目录在 OpenHub 中的定位是**候选建议源**，不是运行时真相：

| 数据来源 | 决策权 |
|---|---|
| 外部模型目录（models.dev） | 提供默认候选：vendor、family、能力标志、limits |
| 站点 `/v1/models` 返回 | 决定该站点上是否存在此模型 |
| 管理员确认 / 向导 | 决定该站点实例的最终能力、adapter、参数 |

三者之间的所有权不重叠。即使目录命中了 `openai/gpt-5`，也不等于该站点的实例支持完整能力，仍需管理员确认。

**与 models.dev 仓库的关系**：
- models.dev 源码仓库（TOML 文件）是其上游规范源，生成 `models.json` 发布于 `https://models.dev/models.json`。
- OpenHub 只消费该生成 JSON，不依赖源码仓库，不引入 Bun 或 TOML 解析链路。
- Windows 文件系统不支持仓库中大量带 `:` 的文件名，因此绝不能把源码仓库直接挂载为 OpenHub 运行时依赖。

---

### 适配器（Adapter）

将 OpenHub 统一请求转换为目标站点特定格式的转换器。每个 New API 站点 / 每类能力差异需要一个适配器。

适配器包含：
- 请求转换（统一格式 → 站点格式）
- 响应转换（站点格式 → 统一格式）
- 错误归一化（站点错误码 → OpenHub 统一错误码）

### 路由（Routing）

根据变体配置和站点健康状态，选择实际执行调用的目标站点的过程。

---

## 3. 技术选型

### 已确认选型

| 层 | 选型 | 理由 |
|---|---|---|
| 后端语言 | TypeScript | 前后端共享类型，生态成熟，适配器类型安全 |
| 后端框架 | Hono | 轻量、边缘可部署、OpenAPI 友好、中间件体系清晰 |
| 运行时 | Node.js (初期) / Bun 可选 | 稳定性优先 |
| 数据库 | SQLite (初期) → PostgreSQL (扩展) | MVP 零依赖，迁移路径清晰 |
| ORM | Drizzle ORM | TypeScript 原生，轻量，支持 SQLite/PG，迁移工具完善 |
| 对外接口格式 | OpenAI 兼容格式 | 调用方直接使用 OpenAI SDK，零改造 |
| 前端 | React + Tailwind CSS | 极简管理界面，最小依赖 |
| 前端构建 | Vite | 快速，配置简单 |
| 包管理 | pnpm | 速度快，monorepo 友好 |
| 加密 | Node.js `crypto` (AES-256-GCM) | 内置，无需引入额外依赖 |

### 合理推测（未最终确认）

- 部署形态：单进程单容器，Docker Compose 启动。
- 缓存：初期无 Redis，热数据放内存 Map，重启丢失可接受。
- 日志：结构化 JSON 日志写 stdout，不引入日志平台。

---

## 4. 系统架构

### 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        调用方软件 / 网站                          │
│                    (OpenAI SDK, baseURL 指向 OpenHub)              │
└─────────────────────────────┬───────────────────────────────────┘
                              │ HTTP (OpenAI 兼容格式)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         OpenHub                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                   鉴权中间件                              │    │
│  │              (Bearer token → variant_id)                │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                  路由决策层                              │    │
│  │         variant_id → {site_id, model_id, rules}         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                  参数适配层                              │    │
│  │    统一请求 → 应用 overrides + mapping → 站点请求         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                  适配器层                                │    │
│  │    LLM Adapter | Image Adapter | Audio Adapter          │    │
│  │    Video Adapter (异步)                                 │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                  转发层                                  │    │
│  │           HTTP → 目标 New API 站点                       │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                  响应适配层                              │    │
│  │            站点响应 → OpenAI 兼容格式                    │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                  任务管理层（视频等异步任务）              │    │
│  │              轮询 worker + 回调通知                      │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     多个 New API 站点                             │
│     站点A (OpenRouter) | 站点B (API2D) | 站点C (自定义)          │
└─────────────────────────────────────────────────────────────────┘
```

### 目录结构

```
openhub/
├── packages/
│   ├── server/                    # Hono 后端
│   │   ├── src/
│   │   │   ├── index.ts              # 入口
│   │   │   ├── routes/
│   │   │   │   ├── gateway.ts        # 对外调用接口 (/v1/*)
│   │   │   │   ├── admin.ts          # 管理接口 (/admin/*)
│   │   │   │   └── health.ts         # 健康检查
│   │   │   ├── middleware/
│   │   │   │   └── auth.ts           # 鉴权中间件
│   │   │   ├── services/
│   │   │   │   ├── site.service.ts       # 站点管理
│   │   │   │   ├── model.service.ts      # 模型管理
│   │   │   │   ├── variant.service.ts    # 变体管理
│   │   │   │   ├── key.service.ts        # API Key 管理
│   │   │   │   └── task.service.ts       # 任务管理
│   │   │   ├── engine/
│   │   │   │   ├── capability/
│   │   │   │   │   ├── recognizer.ts     # 能力识别引擎
│   │   │   │   │   ├── rules.ts          # 内置识别规则
│   │   │   │   │   └── probes.ts         # 探测策略
│   │   │   │   ├── router.ts             # 路由决策
│   │   │   │   ├── adapter.ts            # 适配器基类
│   │   │   │   └── sync.ts               # 模型同步调度
│   │   │   ├── adapters/                 # 各能力适配器
│   │   │   │   ├── base.ts               # 适配器基类
│   │   │   │   ├── llm.adapter.ts
│   │   │   │   ├── image.adapter.ts
│   │   │   │   ├── audio.adapter.ts
│   │   │   │   ├── video.adapter.ts
│   │   │   │   └── transforms/           # 各站点/能力的转换函数
│   │   │   │       ├── openai-like.ts
│   │   │   │       ├── dalle-compatible.ts
│   │   │   │       └── ...
│   │   │   ├── tasks/
│   │   │   │   ├── worker.ts             # 轮询 worker
│   │   │   │   └── scheduler.ts          # 启动时恢复任务
│   │   │   ├── db/
│   │   │   │   ├── schema.ts             # Drizzle schema
│   │   │   │   ├── migrations/
│   │   │   │   └── index.ts
│   │   │   └── utils/
│   │   │       ├── crypto.ts             # 加密解密
│   │   │       └── errors.ts             # 统一错误码
│   │   └── package.json
│   │
│   └── web/                         # React 管理界面
│       ├── src/
│       │   ├── main.tsx
│       │   ├── App.tsx
│       │   ├── pages/
│       │   │   ├── Dashboard.tsx
│       │   │   ├── Sites.tsx
│       │   │   ├── Variants.tsx
│       │   │   ├── Keys.tsx
│       │   │   └── wizard/           # 模型引导配置向导
│       │   │       ├── WizardPage.tsx        # 向导入口页（模型列表 + 未配置提示）
│       │   │       ├── steps/
│       │   │       │   ├── Step1Identity.tsx # Step 1：模型身份确认
│       │   │       │   ├── Step2Capability.tsx # Step 2：能力标签选择
│       │   │       │   ├── Step3Params.tsx  # Step 3：参数细化
│       │   │       │   └── Step4Review.tsx  # Step 4：确认 & 生成变体
│       │   │       └── WizardContext.tsx    # 向导状态
│       │   └── api/                  # 与后端通信
│       └── index.html
├── docker-compose.yml
├── Dockerfile
├── pnpm-workspace.yaml
└── package.json
```

### 请求生命周期（详细）

以 LLM 对话请求为例：

```
1. 调用方 POST /v1/chat/completions
   Headers: Authorization: Bearer openhub-sk-xxx
   Body: { model: "my-gpt4-fast", messages: [...], stream: false }

2. 鉴权中间件
   - 提取 Bearer token
   - SHA-256 hash 后查询 api_keys 表
   - 验证 variant_ids 权限（是否允许访问该变体）
   - 通过则注入 context: { variant_id, api_key_record }

3. 变体解析
   - 从请求 body.model 字段提取变体名
   - 查询 variants 表 JOIN models 表 JOIN sites 表
   - 获取: variant 配置、model 能力标签、site base_url、加密的 site api_key

4. 路由决策
   - 检查 site.status（跳过 error 状态）
   - 检查 site 连接是否超时（超过 5 分钟未检查则先探活）
   - 决定目标 site

5. 参数适配
   - 合并: 调用方请求 + variant.param_overrides
   - 移除: variant.param_blocked 中的字段
   - 映射: variant.field_mapping 重命名字段
   - 校验: 调用方传入的参数是否在 variant 允许范围内（max_tokens 等）

6. 适配器转换
   - LLM Adapter: OpenHub 统一格式 → 目标站点格式
   - 例如: 转换 stop 序列格式、转换 response_format、转换 tools 结构

7. 转发
   - 解密 site.api_key（内存中完成，不记录日志）
   - POST {site.base_url}/v1/chat/completions

8. 响应适配
   - 适配器: 目标站点响应 → OpenAI 兼容格式
   - 标准化错误码

9. 返回调用方
```

---

## 5. 能力识别引擎

能力识别是 OpenHub 自动化的核心。当添加一个新站点时，OpenHub 需要自动判断每个模型的类型和能力。

### 识别优先级（五层机制）

各层按优先级从高到低执行，任意一层命中即停止（仅第一层例外，覆盖始终有效）。识别结果写入 `models.endpoint_caps`、`models.modality` 等字段，并记录 `catalog_match_source` 和 `catalog_match_confidence` 供管理员审计。

#### 第一层：管理员人工覆盖（最高优先级，永远不被覆盖）

`models.caps_overridden = 1` 时，任何同步或目录更新都不修改该行的能力字段和 adapter。
由管理员在管理界面或通过向导"确认生成"后设置。

#### 第二层：站点原生元数据

解析 `/v1/models` 响应中的扩展字段。部分 New API 站点会在模型对象上附加非标准字段，如 `object`, `capabilities`, `input_modalities` 等。

```typescript
function parseNativeCapabilities(rawModel: unknown): Partial<ModelCapability> | null {
  if (!rawModel || typeof rawModel !== 'object') return null;
  const m = rawModel as Record<string, unknown>;

  // New API 可能附加的扩展字段示例
  if (Array.isArray(m['capabilities'])) {
    return { endpoint_caps: m['capabilities'] as string[] };
  }
  return null;  // 未发现扩展字段，继续下一层
}
```

无扩展信息时该层跳过，不使用原始 `id` 字段做任何推断。

#### 第三层：外部模型目录匹配（新增）

从 `model_catalog` 表按规范化后的模型名或 alias 匹配，获取厂商、family、能力标志和限制建议。

**匹配步骤（按顺序）**：

1. 原始 `raw_name` 完整匹配目录 `id`（如 `openai/gpt-5`）
2. 去除常见前缀/后缀后匹配目录 `id`（去 provider 前缀、日期后缀 `-20\d{6}`、量化后缀 `:q4`/`:int8` 等）
3. 查 `model_catalog_alias` 表中的已知别名
4. 同一 `lab_id` + `family` 下，对 token 集做相似度匹配（Jaccard ≥ 0.6）

任意步骤命中后，返回 `CatalogMatchResult`：

```typescript
interface CatalogMatchResult {
  catalog_model_id: string;       // 如 "openai/gpt-5"
  match_source: 'exact' | 'normalized' | 'alias' | 'family_fuzzy';
  confidence: 'high' | 'medium' | 'low';
  suggested_modality: string;
  suggested_endpoint_caps: string[];   // 仅候选，需后续确认
  suggested_param_caps: string[];
  context_window?: number;
  max_output_tokens?: number;
  reasoning_options?: ReasoningOption[];
}
```

**目录字段 → OpenHub 能力的映射规则**：

| models.dev 字段 | 推导的 endpoint_cap | 说明 |
|---|---|---|
| `modalities.output` 含 `image` | `image_generation` | 图片生成 |
| `modalities.input` 含 `image` | `vision` | 图片理解 |
| `modalities.input` 含 `pdf`/`file` | `document_input` | 文档输入 |
| `modalities.output` 含 `audio` | `tts` | 语音合成 |
| `modalities.input` 含 `audio` | `stt` | 语音识别 |
| `modalities.output` 含 `video` | `video_generation` | 视频生成 |
| `tool_call = true` | `function_calling` | 工具调用 |
| `structured_output = true` | `json_mode` | JSON 输出 |
| `reasoning = true` | `reasoning` | 思维链 |
| `attachment = true` | `file_attachment` | 文件上传 |
| family 属于 embedding 类 | `embedding` | 向量嵌入 |

**注意**：上述映射只生成"建议值"写入 `suggested_endpoint_caps`，不直接写入 `models.endpoint_caps`。只有经过第四、第五层或管理员确认后，才正式写入运行时字段。对于 LLM（目录覆盖最充分），confidence=`high` 时可自动写入并标记 `catalog_match_source='catalog'`；对于视频/音频，始终需要管理员确认。

#### 第四层：模型名关键词匹配

目录未命中时，按内置关键词规则推断。

```typescript
const KEYWORD_RULES: Array<{
  keywords: string[];
  modality: string;
  capabilities: string[];
  requires_async?: boolean;
}> = [
  // 图片
  { keywords: ['dall-e', 'stable-diffusion', 'sd-', 'flux', 'imagen', 'ideogram', 'recraft', 'dreamshaper'], modality: 'image', capabilities: ['image_generation'] },
  // 音频
  { keywords: ['whisper', 'asr', 'speech-to-text', 'transcrib'], modality: 'audio', capabilities: ['stt'] },
  { keywords: ['tts', 'text-to-speech', 'bark', 'vits', 'elevenlabs', 'melotts', 'lyria'], modality: 'audio', capabilities: ['tts'] },
  // 视频
  { keywords: ['sora', 'kling', 'wan', 'video-gen', 'pika', 'runway', 'veo', 'dream-machine', 'seedance', 'jimeng', 'hailuo'], modality: 'video', capabilities: ['video_generation'], requires_async: true },
  // Embedding
  { keywords: ['embedding', 'embed', 'text-embedding', 'bge-', 'voyage-', 'cohere-embed'], modality: 'llm', capabilities: ['embedding'] },
  // LLM 通用（兜底，排在最后）
  { keywords: ['gpt', 'claude', 'llama', 'qwen', 'deepseek', 'yi-', 'mistral', 'gemini', 'command', 'kimi', 'moonshot', 'ernie', 'glm', 'hunyuan', 'minimax', 'grok', 'sonar'], modality: 'llm', capabilities: ['chat'] },
];
```

关键词匹配不设置 `context_window` 等数值字段，只推断 modality 和基础 capability。

#### 第五层：能力探测（可选，需配置）

前四层均无法确定时，可发送真实请求探测能力。

探测策略（全局配置项）：
- `probe_mode: 'none'`（默认）— 不探测，未知模型标记为 `unknown`，等待向导配置。
- `probe_mode: 'safe'` — 只读端点（`/v1/models/{id}`、HEAD 请求），不发送生成请求，无费用。
- `probe_mode: 'full'` — 发送最小生成请求（1 token LLM / 64px 图片 / 1s 视频），可能产生费用，需谨慎开启。

探测应设计为**幂等**、**低费用**的请求，结果写入 `suggested_*` 字段，仍需管理员确认。

---

### 识别结果语义

识别结果分为"建议"和"已确认"两个层次，不在同一字段上混用：

| 字段 | 含义 |
|---|---|
| `catalog_model_id` | 匹配到的目录规范 ID |
| `catalog_match_source` | 匹配来源：`admin`/`catalog_exact`/`catalog_alias`/`catalog_fuzzy`/`keyword`/`probe`/`none` |
| `catalog_match_confidence` | 置信度：`high`/`medium`/`low` |
| `catalog_synced_at` | 本次目录匹配时间 |
| `endpoint_caps` | **已确认**能力（运行时生效） |
| `param_caps` | **已确认**参数能力（运行时生效） |
| `caps_overridden` | 是否为人工覆盖（1 = 同步不覆盖） |

管理员可在后台手动修正能力标签，修正后自动设 `caps_overridden = 1`。

---

### 模型能力模板（更新版）

对于已知的模型族（来自目录或关键词匹配），提供预定义的能力模板。目录命中时优先用目录推导，模板仅作为关键词匹配的补充兜底。

```typescript
// LLM 能力模板
const LLM_CAP_TEMPLATES = {
  basic:     { endpoint_caps: ['chat'],                                       param_caps: ['stream'] },
  vision:    { endpoint_caps: ['chat', 'vision'],                             param_caps: ['stream'] },
  tools:     { endpoint_caps: ['chat', 'function_calling'],                   param_caps: ['stream', 'tool_choice'] },
  full:      { endpoint_caps: ['chat', 'vision', 'function_calling'],         param_caps: ['stream', 'tool_choice', 'json_mode', 'seed'] },
  reasoning: { endpoint_caps: ['chat', 'vision', 'function_calling', 'reasoning'], param_caps: ['stream', 'tool_choice', 'json_mode'] },
  embedding: { endpoint_caps: ['embedding'],                                  param_caps: [] },
};

// family → 模板默认值（仅用于关键词匹配兜底；目录命中时忽略此表）
const FAMILY_DEFAULTS: Record<string, { template: keyof typeof LLM_CAP_TEMPLATES; context_window: number }> = {
  'gpt':           { template: 'full',      context_window: 128_000 },
  'gpt-mini':      { template: 'tools',     context_window: 128_000 },
  'o':             { template: 'reasoning', context_window: 200_000 },
  'o-mini':        { template: 'reasoning', context_window: 128_000 },
  'claude-opus':   { template: 'reasoning', context_window: 200_000 },
  'claude-sonnet': { template: 'full',      context_window: 200_000 },
  'claude-haiku':  { template: 'tools',     context_window: 200_000 },
  'claude-fable':  { template: 'reasoning', context_window: 200_000 },
  'gemini':        { template: 'full',      context_window: 1_000_000 },
  'gemini-flash':  { template: 'full',      context_window: 1_000_000 },
  'deepseek':      { template: 'full',      context_window: 64_000 },
  'deepseek-thinking': { template: 'reasoning', context_window: 64_000 },
  'qwen':          { template: 'tools',     context_window: 32_768 },
  'llama':         { template: 'tools',     context_window: 128_000 },
  'kimi':          { template: 'full',      context_window: 200_000 },
  'kimi-k2':       { template: 'reasoning', context_window: 200_000 },
  'grok':          { template: 'full',      context_window: 131_072 },
  'text-embedding': { template: 'embedding', context_window: 8_192 },
};
```

---

## 6. 适配器系统

适配器是将 OpenHub 统一请求转换为目标站点特定格式的核心组件。

### 适配器选择机制

适配器由 `models.adapter_id` 字段决定，在模型同步时按 vendor 自动推断，管理员可手动覆盖。

```
adapter_id 推断优先级：
1. models.adapter_id 已被管理员手动设置 → 直接使用
2. vendor + raw_name 匹配 ADAPTER_RULES（内置映射）→ 自动设置
3. modality=llm / image / audio → 默认 "openai-compatible"
4. modality=video → 标记为 "unknown"，必须手动设置才能调用

内置 ADAPTER_RULES 示例：
  vendor="kling"  → adapter_id="kling-video"
  vendor="runway" → adapter_id="runway-video"
  vendor="wan"    → adapter_id="wan-video"
```

### 适配器基类（含流式支持）

```typescript
// packages/server/src/adapters/base.ts

interface AdapterRequest {
  variant: Variant;
  model: Model;
  site: Site;
  params: Record<string, unknown>;
  siteApiKey: string;  // 已解密，内存中使用，不记录日志
}

// 非流式响应
interface AdapterResponse {
  status: number;
  data: unknown;
}

// 流式响应：SSE chunk 的转换器
interface AdapterStreamChunk {
  // 原始 SSE 行（"data: {...}" 的 {...} 部分）
  rawData: string;
  // 转换后的 OpenAI 兼容 chunk（null 表示跳过此 chunk）
  normalized: string | null;
  // 是否是终止 chunk（[DONE]）
  isDone: boolean;
}

interface Adapter {
  // 适配器 ID，对应 models.adapter_id
  readonly adapterId: string;
  readonly modality: 'llm' | 'image' | 'audio' | 'video';

  // 构造站点请求（非流式和流式均使用此接口）
  transformRequest(req: AdapterRequest): {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: unknown;
  };

  // 非流式响应转换
  transformResponse(status: number, data: unknown, req: AdapterRequest): AdapterResponse;

  // 流式：逐 chunk 转换（LLM SSE）
  // 每次调用处理一条 SSE 行（不含 "data: " 前缀）
  // 实现者负责维护状态（如 accumulated usage）
  transformStreamChunk(rawLine: string, req: AdapterRequest): AdapterStreamChunk;

  // 流式：流结束时调用（可用于追加 usage chunk 等）
  onStreamEnd(req: AdapterRequest): string | null;

  // 错误转换
  transformError(status: number, body: unknown, req: AdapterRequest): OpenHubError;
}
```

**流式转发流程（在 gateway.ts 中）：**

```
1. 向站点发起请求，得到 Response（supports_stream=1 时）
2. 获取 res.body（ReadableStream<Uint8Array>）
3. 解析 SSE 行：按 "\n\n" 分割，提取 "data: " 后的内容
4. 对每条 SSE 行调用 adapter.transformStreamChunk(line, req)
5. chunk.normalized 不为 null → 写入 "data: {normalized}\n\n" 到调用方
6. chunk.isDone → 写入 "data: [DONE]\n\n"，结束流
7. 流中任何错误：写入 OpenAI 格式的 error event，断开连接
8. 流结束：调用 adapter.onStreamEnd(req)，若不为 null 则追加（如 usage chunk）
```

**SSE 中断的客户端可观测行为：**

- 站点连接失败（未开始传输）→ 返回标准 HTTP 错误码（如 502）
- 流传输中途站点断开 → 写入最后一个 error chunk 后关闭连接（客户端收到 ECONNRESET 或不完整流）
- 服务端超时（首字节超时 30s，流中断超时 60s）→ 同上，写入 error chunk

### LLM 适配器

需要处理的主要差异点：

| 差异点 | OpenAI 标准 | 常见变体 |
|---|---|---|
| `stop` 参数 | `stop?: string \| string[]` | 有些站点叫 `stop_words`，有些只支持 `string` |
| `response_format` | `{ type: "json_object" }` | 有些站点叫 `response_constraint`，有些不支持 |
| `tools` | `tools?: Tool[]` | 结构可能略有差异 |
| `max_tokens` | `max_tokens?: number` | 有些站点用 `max_output_tokens` 或 `tokens_limit` |
| `stream` | `stream?: boolean` | 部分站点不支持流式 |
| `frequency_penalty` | `frequency_penalty?` | 部分站点不支持 |
| `seed` | `seed?: number` | 部分站点支持或用不同参数名 |

### 图片适配器

需要处理的主要差异点：

| 差异点 | OpenAI 标准 | 常见变体 |
|---|---|---|
| `model` | `dall-e-3` 等 | 站点可能用不同模型标识 |
| `size` | `1024x1024` 等 | 部分站点只支持特定分辨率 |
| `quality` | `standard \| hd` | 部分站点不支持 |
| `style` | `vivid \| natural` | 部分站点不支持 |
| `n` | 图片数量 | 部分站点不支持多图 |
| 响应格式 | `{ url: string }` 或 `{ b64_json: string }` | 可能有差异 |

### 音频适配器

需要处理的主要差异点：

| 差异点 | OpenAI 标准 | 常见变体 |
|---|---|---|
| TTS `voice` | `alloy \| echo \| ...` | 部分站点有自定义 voice ID |
| TTS `response_format` | `mp3 \| opus \| ...` | 部分站点只支持 mp3 |
| TTS `speed` | `0.25 ~ 4.0` | 部分站点不支持 |
| STT `language` | `language?` | 部分站点只支持通过文件后缀指定 |
| STT `prompt` | 部分站点支持 | 部分站点不支持 |

### 视频适配器（异步）

视频是最复杂的模态，因为几乎每个站点都有完全不同的异步接口：

```typescript
// 视频适配器的核心职责是将异步流程统一化

interface VideoAdapter extends Adapter {
  modality: 'video';

  // 1. 提交任务，返回站点 task_id
  submitTask(params: AdapterRequest): Promise<{ siteTaskId: string }>;

  // 2. 查询任务状态
  queryTask(siteTaskId: string, params: AdapterRequest): Promise<TaskStatus>;

  // 3. 将站点任务状态映射为 OpenHub 统一状态
  mapStatus(siteStatus: string): 'pending' | 'processing' | 'completed' | 'failed';

  // 4. 将站点结果转换为统一格式
  transformResult(siteResult: unknown): VideoResult;
}

// 视频结果统一格式
interface VideoResult {
  video_url: string;       // 视频下载 URL
  cover_url?: string;      // 封面图 URL
  duration?: number;       // 时长（秒）
  width?: number;
  height?: number;
  seed?: number;           // 随机种子
  // ... 其他通用字段
}
```

常见视频站点的接口差异示例：

| 站点 | 提交接口 | 查询接口 | 返回格式 |
|---|---|---|---|
| OpenAI Sora | `POST /v1/video/generations` | `GET /v1/video/generations/{id}` | `{ id, status, video_url }` |
| Kling | `POST /v1/video/generations` | `GET /v1/video/generations/{task_id}` | `{ task_id, task_status, ... }` |
| Wan | `POST /v1/generations` | `GET /v1/generations/{id}` | `{ id, status, output }` |
| Runway | `POST /v1图像生成任务` | `GET /v1图像生成任务/{id}` | `{ id, status, ... }` |

**每个视频模型供应商都需要独立的适配器实现。**

### 响应标准化

所有适配器最终返回的响应格式统一为 OpenAI 兼容格式：

```typescript
// LLM 响应标准化
interface NormalizedChatResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// 图片响应标准化
interface NormalizedImageResponse {
  created: number;
  data: Array<{
    url?: string;
    b64_json?: string;
    revised_prompt?: string;
  }>;
}

// 音频响应标准化
interface NormalizedSpeechResponse {
  // 二进制音频流
}

interface NormalizedTranscriptionResponse {
  text: string;
}
```

---

## 7. 数据模型

### ER 图

```
model_catalog 1───* model_catalog_alias
model_catalog 1───* catalog_sync_runs (仅用于审计，不关联业务表)
model_catalog 0───* models            (通过 models.catalog_model_id 关联，可为 NULL)

sites 1───* models 1───* variants *────* api_keys  (通过 api_keys.allowed_variant_ids JSON 数组关联)
                                   │
                                   └─── tasks (异步任务) *──── api_keys (created_by_api_key_id)
```

> MVP 阶段 api_key ↔ variant 采用 JSON 数组字段（`allowed_variant_ids`）而非关联表。
> 允许的最大变体数为 100 个/Key，超出时 POST /admin/api-keys 返回 400。
> 当变体被软删除时，需从所有 Key 的 `allowed_variant_ids` 中清除该 ID。
> `model_catalog` 与 `models` 为可选关联：目录只提供建议，站点实例可以不匹配任何目录条目。

### 表结构

#### sites（站点）

```sql
CREATE TABLE sites (
  id          TEXT PRIMARY KEY,           -- UUID
  name        TEXT NOT NULL,             -- 站点名称，如 "OpenRouter 主站"
  base_url    TEXT NOT NULL,             -- New API 地址，不含末尾斜杠
  api_key_enc TEXT NOT NULL,             -- AES-256-GCM 加密后的 API Key
  status      TEXT NOT NULL DEFAULT 'active',
                                         -- active: 可用
                                         -- disabled: 管理员禁用
                                         -- error: 连续失败，自动标记
  error_count INTEGER NOT NULL DEFAULT 0,
  last_check  INTEGER,                  -- Unix 时间戳，最后一次连接探测时间
  last_error  TEXT,                     -- 最近一次错误信息
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX idx_sites_status ON sites(status);
```

#### models（站点模型实例）

> 同一个供应商模型在不同站点是独立记录。

```sql
CREATE TABLE models (
  id              TEXT PRIMARY KEY,
  site_id         TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  raw_name        TEXT NOT NULL,         -- 站点返回的原始模型名
  display_name    TEXT,                 -- 可读名称，如 "GPT-4o 图片版"

  -- 供应商溯源（用于跨站点聚合和规则匹配）
  vendor          TEXT,                 -- openai | anthropic | google | meta | alibaba | ...
  family          TEXT,                 -- 主干名，如 "gpt-4o"（不含日期戳/量化后缀）
  model_version   TEXT,                 -- 版本标识，如 "2024-08-06"

  -- 适配器绑定（决定用哪个 Adapter 处理请求）
  adapter_id      TEXT NOT NULL DEFAULT 'openai-compatible',
                                        -- openai-compatible | anthropic | kling | wan | ...
                                        -- 同步时按 vendor+raw_name 自动推断，管理员可覆盖

  -- 模态和能力（分两层，不混用）
  modality        TEXT NOT NULL,        -- llm | image | audio | video
  -- endpoint_caps: 核心端点能力标签 JSON 数组
  --   llm: ["chat","embedding","vision","function_calling"]
  --   image: ["image_generation","image_editing","image_variation"]
  --   audio: ["tts","stt"]
  --   video: ["video_generation","video_editing"]
  endpoint_caps   TEXT NOT NULL DEFAULT '[]',
  -- param_caps: 请求选项能力标签 JSON 数组
  --   ["json_mode","stream","seed","tool_choice","response_format"]
  param_caps      TEXT NOT NULL DEFAULT '[]',

  -- 人工修正标志（防止同步覆盖）
  caps_overridden INTEGER NOT NULL DEFAULT 0, -- 1 = 人工修正，同步时跳过 caps 更新

  -- 外部模型目录关联（可选，由能力识别引擎自动填充）
  catalog_model_id   TEXT,                  -- 关联 model_catalog.id，如 "openai/gpt-5"
  catalog_match_source TEXT,               -- 匹配来源：admin | catalog_exact | catalog_alias | catalog_fuzzy | keyword | probe | none
  catalog_match_confidence TEXT,           -- 置信度：high | medium | low
  catalog_synced_at  INTEGER,              -- 最近一次目录匹配时间（Unix ms）

  -- LLM 专用限制
  context_window  INTEGER,               -- 最大上下文 token 数
  max_output_tokens INTEGER,             -- 最大输出 token 数（独立字段，不与图片/视频混用）
  supports_reasoning INTEGER NOT NULL DEFAULT 0,  -- 是否支持思维链（0/1）

  -- 图片专用限制（JSON，如 ["256x256","512x512","1024x1024"]）
  supported_sizes TEXT,

  -- 视频专用限制
  max_duration_sec INTEGER,              -- 最大时长（秒）

  -- 调用方式
  supports_stream INTEGER NOT NULL DEFAULT 1,  -- 0/1
  requires_async  INTEGER NOT NULL DEFAULT 0,  -- 0/1

  -- 运行时指标（用于路由参考，异步更新）
  last_latency_ms INTEGER,
  avg_latency_ms  INTEGER,

  -- 状态
  status          TEXT NOT NULL DEFAULT 'active',
                                          -- active: 可用
                                          -- degraded: 能力下降（如配额不足）
                                          -- offline: 同步时未出现
                                          -- unknown: 能力未知
  status_reason   TEXT,                  -- 状态原因（如 "quota_exceeded"）

  -- 同步元数据
  synced_at       INTEGER NOT NULL,      -- 最后同步时间
  created_at      INTEGER NOT NULL,

  UNIQUE(site_id, raw_name)
);

CREATE INDEX idx_models_site ON models(site_id);
CREATE INDEX idx_models_modality ON models(modality);
CREATE INDEX idx_models_status ON models(status);
CREATE INDEX idx_models_vendor_family ON models(vendor, family);
CREATE INDEX idx_models_catalog ON models(catalog_model_id);
```

#### model_catalog（外部模型目录镜像）

> 只读镜像，由同步任务写入，业务代码只读。数据来源：`https://models.dev/models.json`。

```sql
CREATE TABLE model_catalog (
  id              TEXT PRIMARY KEY,      -- 规范 ID，如 "openai/gpt-5"（格式：{lab_id}/{model_id}）
  lab_id          TEXT NOT NULL,         -- 厂商 ID，如 "openai" | "anthropic" | "google"
  lab_name        TEXT,                  -- 厂商可读名，如 "OpenAI"
  name            TEXT NOT NULL,         -- 可读模型名，如 "GPT-5"
  description     TEXT,                  -- 模型描述
  family          TEXT,                  -- model family，如 "gpt" | "claude-opus" | "gemini-flash"
                                         -- 来自 models.dev family.ts 枚举，用于 family 级模糊匹配

  -- 能力标志（来自 models.dev schema，布尔值存 0/1）
  attachment      INTEGER,               -- 是否支持文件/附件上传
  reasoning       INTEGER,               -- 是否支持思维链推理
  tool_call       INTEGER,               -- 是否支持工具调用
  structured_output INTEGER,             -- 是否支持结构化输出
  temperature     INTEGER,               -- 是否支持 temperature 参数

  -- 模态（JSON 数组，如 ["text","image","pdf"]）
  modalities_in   TEXT,                  -- 输入 modality 列表
  modalities_out  TEXT,                  -- 输出 modality 列表

  -- 默认限制（来自 models/目录，provider 可覆盖）
  context_limit   INTEGER,               -- 默认最大上下文 token 数
  input_limit     INTEGER,               -- 默认最大输入 token 数
  output_limit    INTEGER,               -- 默认最大输出 token 数

  -- 推理选项（JSON，来自 schema 中的 ReasoningOption[]）
  -- 例如：[{"type":"effort","values":["minimal","low","medium","high"]}]
  reasoning_options TEXT,

  -- 模型元数据
  open_weights    INTEGER,               -- 是否开源权重（0/1）
  license         TEXT,                  -- 许可证
  release_date    TEXT,                  -- 发布日期（YYYY-MM-DD 或 YYYY-MM）
  last_updated    TEXT,                  -- 最后更新日期
  knowledge_date  TEXT,                  -- 知识截止日期

  -- 来源与版本
  source_url      TEXT,                  -- 来源 URL，如 "https://models.dev/models.json"
  source_version  TEXT,                  -- 目录版本标识（etag 或 content hash）
  raw_payload     TEXT,                  -- 原始 JSON 片段，保留以备字段扩展

  fetched_at      INTEGER NOT NULL,      -- 同步时间（Unix ms）
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX idx_catalog_lab ON model_catalog(lab_id);
CREATE INDEX idx_catalog_family ON model_catalog(family);
CREATE INDEX idx_catalog_updated ON model_catalog(updated_at);
```

#### model_catalog_alias（目录别名表）

> 记录已知的模型别名，用于能力识别引擎第三层的别名匹配。

```sql
CREATE TABLE model_catalog_alias (
  id              TEXT PRIMARY KEY,      -- UUID
  catalog_id      TEXT NOT NULL REFERENCES model_catalog(id) ON DELETE CASCADE,
  alias           TEXT NOT NULL,         -- 原始别名，如 "gpt-5-2025-08-07" | "openai/gpt-5"
  normalized      TEXT NOT NULL,         -- 标准化后的别名（小写、去日期后缀等）
  alias_type      TEXT NOT NULL,         -- exact | provider_id | slug | legacy | manual
                                         -- exact：与目录 id 完全一致的变体
                                         -- provider_id：某 provider 使用的 id
                                         -- slug：URL slug 变体
                                         -- legacy：已废弃但仍流通的旧名
                                         -- manual：管理员手动录入
  priority        INTEGER NOT NULL DEFAULT 50,  -- 越小优先级越高，0=最高

  created_at      INTEGER NOT NULL,

  UNIQUE(normalized, alias_type)
);

CREATE INDEX idx_alias_catalog ON model_catalog_alias(catalog_id);
CREATE INDEX idx_alias_normalized ON model_catalog_alias(normalized);
```

#### catalog_sync_runs（目录同步运行记录）

> 只用于审计和排查，不参与业务逻辑。

```sql
CREATE TABLE catalog_sync_runs (
  id              TEXT PRIMARY KEY,      -- UUID
  source_url      TEXT NOT NULL,         -- 同步源 URL
  started_at      INTEGER NOT NULL,
  finished_at     INTEGER,
  status          TEXT NOT NULL,         -- success | failed | partial
  record_count    INTEGER,               -- 同步处理的条目总数
  changed_count   INTEGER,               -- 本次有变更的条目数
  schema_version  TEXT,                  -- 目录 schema 版本标识（etag 或 hash）
  error_message   TEXT,                  -- 失败时的错误信息
  triggered_by    TEXT NOT NULL          -- auto | manual
);

CREATE INDEX idx_sync_runs_status ON catalog_sync_runs(status);
CREATE INDEX idx_sync_runs_started ON catalog_sync_runs(started_at);
```

#### variants（变体）

```sql
CREATE TABLE variants (
  id              TEXT PRIMARY KEY,

  -- 对外暴露的名称（调用方使用）
  name            TEXT NOT NULL UNIQUE,

  -- 绑定到具体模型实例
  model_id        TEXT NOT NULL REFERENCES models(id),

  -- 业务信息
  description     TEXT,

  -- 参数配置（JSON）
  param_overrides TEXT,    -- 默认参数，调用方未传时使用
  param_blocked   TEXT,    -- 禁止使用的参数名列表
  field_mapping   TEXT,    -- 字段名映射 { hub字段: 站点字段 }

  -- 能力限制
  max_context     INTEGER,  -- 最大上下文长度
  max_output      INTEGER,  -- 最大输出
  max_images      INTEGER,  -- 最大图片数（多图生成时）
  max_duration    INTEGER,  -- 视频最大时长（秒）
  max_audio_len   INTEGER,  -- 音频最大长度（秒）

  -- 可见性
  is_public       INTEGER NOT NULL DEFAULT 1,

  -- 时间
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX idx_variants_model ON variants(model_id);
CREATE INDEX idx_variants_name ON variants(name);
```

#### api_keys（Hub 对外发行的虚拟 Key）

```sql
CREATE TABLE api_keys (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,             -- Key 名称，如 "前端项目 Key"
  key_hash    TEXT NOT NULL UNIQUE,      -- SHA-256 hash

  -- 展示用
  key_prefix  TEXT NOT NULL,             -- "openhub-sk-"
  key_suffix  TEXT NOT NULL,             -- 末4位

  -- 权限（JSON 数组，null 表示允许全部变体；最大 100 条）
  allowed_variant_ids TEXT,

  -- 状态
  status      TEXT NOT NULL DEFAULT 'active',  -- active | revoked
  revoked_at  INTEGER,                   -- 撤销时间（用于审计）

  -- 使用统计（last_used 写频繁，可异步更新）
  last_used   INTEGER,
  use_count   INTEGER NOT NULL DEFAULT 0,

  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_status ON api_keys(status);
```

#### tasks（异步任务）

```sql
CREATE TABLE tasks (
  id              TEXT PRIMARY KEY,

  -- 关联
  site_id         TEXT NOT NULL REFERENCES sites(id),
  variant_id      TEXT NOT NULL REFERENCES variants(id),
  model_id        TEXT NOT NULL REFERENCES models(id),

  -- 归属（用于权限校验：调用方只能查自己提交的任务）
  created_by_key_id TEXT NOT NULL REFERENCES api_keys(id),

  -- 幂等（客户端提供 Idempotency-Key，重复提交返回已有任务）
  idempotency_key TEXT UNIQUE,

  -- 站点任务标识
  site_task_id    TEXT,                   -- 站点返回的原始 task_id

  -- 任务类型
  type            TEXT NOT NULL,          -- video | audio_long | image_variation

  -- 任务调度元数据（仅存必要字段，不存用户输入内容，避免敏感数据落库）
  task_meta       TEXT,                   -- JSON：{ model_id, variant_id, duration, aspect_ratio 等调度字段 }

  -- 状态机（转换规则见"状态机"小节，使用 WHERE status=? 条件更新防止竞争）
  status          TEXT NOT NULL DEFAULT 'pending',
                                          -- pending:    已提交，等待 worker 认领
                                          -- processing: 站点处理中
                                          -- completed:  已完成
                                          -- failed:     站点返回失败
                                          -- timeout:    超过 max_polling_at 仍未完成

  -- 结果（视频 URL 为临时签名 URL，result_expires_at 记录有效期）
  result          TEXT,                   -- JSON 结果
  result_expires_at INTEGER,              -- 结果 URL 的过期时间（Unix 时间戳）
  error           TEXT,

  -- 回调（HMAC 签名由 api_key 生成，接收方用 webhook_secret 验证）
  callback_url    TEXT,                   -- 必须 HTTPS，不允许私网地址
  callback_secret TEXT,                   -- HMAC-SHA256 签名密钥（管理员配置）
  callback_attempts INTEGER NOT NULL DEFAULT 0,
  callback_next_at  INTEGER,             -- 下次重试时间（退避策略）
  callback_done   INTEGER NOT NULL DEFAULT 0,  -- 0 | 1

  -- 超时控制
  -- max_polling_at = created_at + 24h（提交即设置，不依赖 started_at）
  max_polling_at  INTEGER NOT NULL,
  started_at      INTEGER,               -- 站点确认开始处理时间
  completed_at    INTEGER,

  -- 轮询
  poll_count      INTEGER NOT NULL DEFAULT 0,
  last_poll_at    INTEGER,

  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_key ON tasks(created_by_key_id);
CREATE INDEX idx_tasks_site ON tasks(site_id);
CREATE INDEX idx_tasks_max_polling ON tasks(max_polling_at);
CREATE INDEX idx_tasks_callback ON tasks(callback_done, callback_next_at);
```

**任务状态机——合法转换**

| 当前状态 | 目标状态 | 触发方 |
|---|---|---|
| pending | processing | worker 认领并提交站点成功后 |
| pending | failed | 提交站点失败 |
| pending | timeout | max_polling_at 到期（启动时批量更新） |
| processing | completed | 轮询结果为成功 |
| processing | failed | 轮询结果为失败 |
| processing | timeout | max_polling_at 到期 |
| failed | processing | 管理员手动重试 |

所有状态更新使用条件写：`UPDATE tasks SET status=? WHERE id=? AND status=?`，避免并发覆盖。

---

## 8. 变体系统

变体是调用方实际使用的模型标识符。它在底层模型实例之上封装了一层业务适配逻辑。

### 变体命名

变体名是自由文本，但对内要保证唯一性。推荐命名格式：

```
{用途}-{特性}
示例：my-gpt4-fast | production-claude | image-gen-v3 | video-portrait-mode
```

### 变体参数覆盖

```typescript
// 示例：一个 "快速 GPT-4" 变体
{
  id: "var_xxx",
  name: "my-gpt4-fast",
  model_id: "mod_gpt4o_from_openrouter",

  // 强制覆盖：无论调用方传什么，都用这些值
  param_overrides: {
    temperature: 0.7,
    max_tokens: 4096,
    // 调用方传了 temperature 会被覆盖
  },

  // 阻止使用：调用方传了这些参数会被丢弃
  param_blocked: [
    "response_format",   // 禁用 json_mode，保持速度
    "seed",              // 禁用确定性，保证速度
  ],

  // 限制
  max_output: 8192,      // 最大输出限制
}
```

### 变体字段映射

```typescript
// 示例：从 OpenAI 标准字段名映射到站点特有字段名
{
  field_mapping: {
    // Hub 字段 → 站点字段
    "max_tokens": "max_output_tokens",
    "stop": "stop_words",
    "response_format": "response_constraint",
    "frequency_penalty": "repetition_penalty"
  }
}
```

### MVP 变体绑定限制

**MVP 阶段：一个变体只绑定一个 model 实例（由 `model_id` 字段唯一确定）。**

多模型绑定（如多模态变体、跨站点降级）属于 Phase 3 功能，届时引入 `variant_bindings` 关联表。

MVP 阶段如果调用方的请求能力与变体绑定模型的能力不匹配（如向 LLM 变体发送图片生成请求），返回 400 错误并提示调用方使用正确的变体。能力检查基于 `models.modality` + `models.endpoint_caps`。

---

## 9. 参数映射配置

参数映射是适配器执行转换的配置来源。每个站点模型实例可以有自己的一组映射规则。

### 映射类型

#### 1. 字段重命名（Field Rename）

将 OpenHub 统一字段名映射到目标站点的字段名。

```typescript
// 场景：OpenAI 的 max_tokens → 某站点的 max_output_tokens
{
  field_rename: {
    "max_tokens": "max_output_tokens"
  }
}
```

#### 2. 值转换（Value Transform）

将参数值从一种格式转换为另一种格式。

```typescript
// 场景：OpenAI 的 stop: string[] → 某站点的 stop: string（逗号分隔）
{
  field_transforms: {
    "stop": {
      type: "array_to_string",
      separator: ","
    }
  }
}

// 场景：OpenAI 的 size: "1024x1024" → 某站点的 width/height
{
  field_transforms: {
    "size": {
      type: "parse_dimensions"
    }
  }
}

// 场景：OpenAI 的 response_format: { type: "json_object" } → 某站点需要转换为字符串
{
  field_transforms: {
    "response_format": {
      type: "extract_type"
    }
  }
}
```

#### 3. 固定值注入（Fixed Value Injection）

某些站点需要 OpenAI 标准中没有的额外参数。

```typescript
// 场景：某站点必须指定 api_version
{
  fixed_params: {
    "api_version": "2024-06-01"
  }
}

// 场景：某站点需要指定供应商
{
  fixed_params: {
    "provider": "anthropic"
  }
}
```

#### 4. 参数删除（Parameter Removal）

某些 OpenAI 参数在目标站点不支持，直接丢弃。

```typescript
{
  param_blocked: [
    "presence_penalty",    // 站点不支持
    "seed",                // 站点不支持
  ]
}
```

#### 5. 参数默认值（Default Value）

当调用方未传某参数时，使用默认值。

```typescript
{
  param_defaults: {
    "model": "gpt-4o-mini",       // 站点默认模型
    "temperature": 0.7,
    "size": "1024x1024",
    "quality": "standard"
  }
}
```

### 映射执行顺序（唯一正典）

以下是参数管线的**单一权威执行顺序**，代码中不允许有其他顺序。

```
输入：调用方原始请求 body（已 JSON.parse）

Step 1 — 能力校验（请求发出前）
  - 检查请求类型是否匹配 variant 绑定的 model.modality + endpoint_caps
  - 超出 max_context / max_output / max_images / max_duration 的参数值报 400

Step 2 — 移除 param_blocked（变体级）
  - 遍历 variant.param_blocked 列表
  - 按原始字段名（OpenHub 侧名称）删除，此时还未重命名
  - "未设置"的定义：JSON.parse 后 Object.prototype.hasOwnProperty 为 false
  - 注意：null / false / 0 / "" 均视为"已设置"，不触发默认值填充

Step 3 — 合并 param_defaults（适配器级，只填充未设置的字段）
  - 来自 Adapter 的静态 defaultParams
  - 仅在 Step 2 之后字段不存在时注入
  - 不覆盖已有值

Step 4 — 应用 param_overrides（变体级，强制覆盖）
  - 来自 variant.param_overrides
  - 无条件覆盖，优先级最高

Step 5 — 固定值注入（适配器级，站点必须字段）
  - 来自 Adapter 的 fixedParams（如 api_version）
  - 无条件覆盖，用于站点要求的额外参数

Step 6 — 字段重命名（field_mapping）
  - 来自 variant.field_mapping
  - 重命名后，参数名变为站点侧名称

Step 7 — 值转换（field_transforms）
  - 来自 Adapter 的 transforms 配置
  - 在重命名后执行，使用站点侧名称匹配

Step 8 — 未知参数处理
  - OpenHub 已知的标准字段：允许透传
  - 未知字段（不在 OpenAI 规范中）：默认丢弃
  - 如需透传供应商扩展参数，调用方应放在 provider_options 中，
    Adapter 负责将其解包并注入到站点请求

输出：站点请求 body
```

**各 Step 的边界说明**

| 情形 | 处理 |
|---|---|
| 调用方传 `null` | 视为已设置，不触发 param_defaults |
| 调用方传 `undefined` | JSON 序列化后字段消失，视为未设置，触发 param_defaults |
| param_blocked 与 param_overrides 同名 | Step 2 先删，Step 4 再注入（最终存在） |
| field_mapping 后字段名与 param_blocked 中原名冲突 | 不冲突，blocked 在 rename 之前执行 |
| 调用方传了不在任何 allowed 列表的字段 | Step 8 丢弃，不报错，不透传 |

---

## 10. API 设计

### 对外调用接口（OpenAI 兼容，Bearer Token 鉴权）

#### LLM

```
POST /v1/chat/completions
  请求: OpenAI Chat Completions 格式
  响应: OpenAI Chat Completions 格式
  注意: model 字段填写变体名

POST /v1/embeddings
  请求: { model: string, input: string | string[] }
  响应: OpenAI Embeddings 格式
```

#### 图片

```
POST /v1/images/generations
  请求: OpenAI Images 格式（model 字段为变体名）
  响应: OpenAI Images 格式

POST /v1/images/edits
  请求: multipart/form-data
  响应: OpenAI Images 格式

POST /v1/images/variations
  请求: multipart/form-data
  响应: OpenAI Images 格式
```

#### 音频

```
POST /v1/audio/speech
  请求: { model, input, voice, ... }
  响应: audio/* 二进制流

POST /v1/audio/transcriptions
  请求: multipart/form-data (file + model)
  响应: { text: string }
```

#### 视频（OpenHub 自定义，非 OpenAI 标准）

```
POST /v1/video/generations
  请求: {
    model: string,              // 变体名
    prompt: string,
    duration?: number,           // 秒
    aspect_ratio?: string,       // "16:9" | "9:16" | "1:1"
    callback_url?: string,       // 完成通知（必须 HTTPS）
    callback_secret?: string,    // 接收方 HMAC 验证密钥
    idempotency_key?: string     // 客户端幂等 Key，同一 Key 重复提交返回已有任务
  }
  响应: {
    id: string,                 // OpenHub task_id
    status: "pending",
    created_at: number
  }
  幂等处理：若 idempotency_key 已存在且任务未超时，直接返回已有任务（200）

GET /v1/video/tasks/{task_id}
  权限: 只能查自己提交的任务（Bearer Key 必须与 created_by_key_id 匹配）
  响应: {
    id: string,
    status: "pending" | "processing" | "completed" | "failed" | "timeout",
    created_at: number,
    started_at?: number,
    completed_at?: number,
    result?: {
      video_url: string,
      cover_url?: string,
      duration?: number,
      result_expires_at?: number  // URL 过期时间，过期后需重新获取
    },
    result_url_expired?: boolean, // true 时 video_url 已失效
    error?: string
  }
```

---

### 管理接口（HTTP Basic Auth 或 IP 白名单保护）

**删除语义说明：**

- 所有"删除"操作均为**软删除**（`deleted_at = now()`），不物理删除行。
- 已有活跃任务引用的 variant / model，禁止删除，返回 409。
- 已有变体绑定的 model，禁止删除，返回 409。
- 删除 site 时，级联软删除其下的所有 model（同步时未出现的 model 会变 `offline`，不应 cascade 删除）。
- 软删除的记录不在列表接口返回（除非加 `?include_deleted=true`）。

#### 站点

```
GET    /admin/sites                          # 列表
POST   /admin/sites                          # 添加（添加后自动触发首次模型同步）
GET    /admin/sites/:id                      # 详情（含模型列表）
PUT    /admin/sites/:id                      # 更新（不含 api_key，api_key 单独接口）
PUT    /admin/sites/:id/key                  # 更新 API Key（单独接口，避免误更新）
DELETE /admin/sites/:id                      # 软删除（先检查是否有 active 变体引用）
POST   /admin/sites/:id/sync                  # 手动同步模型
POST   /admin/sites/:id/test                  # 测试连接
```

#### 模型

```
GET    /admin/models?site_id=&modality=&status=  # 列表，支持筛选
GET    /admin/models/:id                    # 详情
PATCH  /admin/models/:id                    # 修改 display_name、adapter_id、endpoint_caps 等
                                            # PATCH caps 后自动设置 caps_overridden=1，防止同步覆盖
```

#### 变体

```
GET    /admin/variants                      # 列表
POST   /admin/variants                      # 创建
GET    /admin/variants/:id                  # 详情
PUT    /admin/variants/:id                  # 更新
DELETE /admin/variants/:id                  # 软删除（级联从 api_keys.allowed_variant_ids 中移除）
```

#### API Key

```
GET    /admin/api-keys                       # 列表（不显示完整 Key）
POST   /admin/api-keys                       # 创建，返回一次性明文
POST   /admin/api-keys/:id/revoke            # 撤销（设置 status=revoked + revoked_at，立即生效）
                                             # 不用 DELETE，保留记录用于审计
```

#### 任务

```
GET    /admin/tasks?status=&site_id=&type=  # 列表
GET    /admin/tasks/:id                      # 详情
POST   /admin/tasks/:id/retry                # 重试（status 从 failed 改为 pending，重新入队）
```

---

## 11. 安全设计

### 站点 API Key 加密

```
存储格式: base64(iv[12字节] + ciphertext + authTag[16字节])，三段连接为单字符串
算法:      AES-256-GCM
密钥来源:  环境变量 OPENHUB_MASTER_KEY（32字节 hex，必填）
IV:        随机生成，每条记录独立，存于密文前缀
验证:      解密仅在内存中，不记录日志，不序列化到 JSON 响应
展示:      后台只显示 "****...xxxx"（末4位）
```

**Key 轮换流程（当 MASTER_KEY 需要更换时）：**

1. 新 Key 写入 `OPENHUB_MASTER_KEY_NEXT` 环境变量。
2. 执行迁移命令：`openhub rotate-keys`，批量解密（用旧 Key）+ 重加密（用新 Key）所有 `sites.api_key_enc`。
3. 迁移完成后，将 `OPENHUB_MASTER_KEY_NEXT` 的值移到 `OPENHUB_MASTER_KEY`，重启服务。
4. 如迁移失败，旧 Key 仍有效，不会丢失数据。

### Hub API Key

```
生成:  openhub-sk- + 24字节随机 base62 = 约 43 字符总长
存储:  SHA-256 hash（不存明文）
验证:  hash 请求头中的 Key，与数据库 key_hash 比对
展示:  创建时一次性返回完整明文，之后只展示前缀 + "..." + 末4位
撤销:  status=revoked + revoked_at=now，立即生效（鉴权时检查 status）
```

### URL 安全校验（SSRF 防护）

**适用范围：** 所有用户输入的 URL，包括 `sites.base_url` 和 `tasks.callback_url`。

```typescript
// 所有 URL 保存前必须经过此校验
function validateUrl(url: string, type: 'site' | 'callback'): void {
  const parsed = new URL(url);  // 格式无效时抛出

  // 仅允许 HTTPS（sites 在开发模式下可放行 http://localhost）
  if (type === 'callback' && parsed.protocol !== 'https:') {
    throw new Error('callback_url 必须使用 HTTPS');
  }

  // 禁止私网/回环/链路本地地址（防止 SSRF）
  // 实现：DNS 解析后检查 IP，或用 is-lan-ip 等库
  // 禁止: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8, ::1, 169.254.0.0/16
  assertNotPrivateIp(parsed.hostname);

  // 禁止重定向（fetch 时设置 redirect: 'error'）
}
```

**转发请求时的额外限制：**
- 连接超时：5 秒
- 响应头超时：30 秒
- 响应体大小上限：50 MB（音视频大文件除外，视频用 task 模式不直接代理）
- 禁止跟随重定向（`redirect: 'error'`）

### Callback 安全

```
签名算法: HMAC-SHA256
签名密钥: tasks.callback_secret（管理员在创建任务时配置，或每个 Key 有默认 webhook_secret）
签名字段: X-OpenHub-Signature: sha256={hex}
签名内容: 完整 payload JSON 字符串
时间戳防重放: payload 中包含 timestamp，接收方应拒绝 5 分钟前的通知
```

**接收方验证示例：**

```typescript
const sig = request.headers['x-openhub-signature'];
const expected = 'sha256=' + createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
  return 401;
}
const { timestamp } = JSON.parse(rawBody);
if (Date.now() - timestamp > 5 * 60 * 1000) return 401; // 防重放
```

### 管理接口保护

```
方式: HTTP Basic Auth（MVP）
配置: 环境变量 OPENHUB_ADMIN_USER / OPENHUB_ADMIN_PASSWORD
注意: 管理后台不应暴露到公网；生产建议 Nginx 层 IP 白名单限制
```

### 数据库文件保护

- **Linux/macOS**：`chmod 600 openhub.db`，以非 root 用户运行容器。
- **Windows**：设置文件 ACL，仅允许服务账户读写。
- **容器挂载**：数据卷不应设置为公开可读，`docker-compose.yml` 中不挂载到 `/tmp` 或公开目录。
- **备份**：备份文件同样需要加密存储，不要直接复制明文 DB 到不安全位置。

### 日志安全

- 所有日志必须包含 `api_key_id`（不含 Key 本身）用于追踪。
- 禁止记录：解密后的 `site_key`、完整的 `Authorization` 头、`callback_secret`。
- 推荐日志格式（结构化 JSON）：

```json
{
  "level": "info",
  "ts": 1720000000,
  "request_id": "req_xxx",
  "api_key_id": "key_xxx",
  "variant_name": "my-gpt4-fast",
  "site_id": "site_xxx",
  "latency_ms": 1234,
  "status": 200
}
```

### 环境变量清单

```bash
OPENHUB_MASTER_KEY=<32字节hex, 必填>      # AES-256 主密钥
OPENHUB_MASTER_KEY_NEXT=<32字节hex>        # 轮换时填写新密钥
OPENHUB_ADMIN_USER=<用户名>               # 管理后台账号
OPENHUB_ADMIN_PASSWORD=<强密码>           # 管理后台密码
OPENHUB_PORT=3000                         # 端口，默认 3000
OPENHUB_CORS_ORIGINS=https://app.xxx.com  # 允许的前端域名
OPENHUB_ALLOW_HTTP_SITES=false            # 开发模式允许 http:// 站点
DATABASE_URL=./openhub.db                 # SQLite 路径 或 postgres://...
NODE_ENV=production                       # 生产模式
```

---

## 12. UI 设计原则

**核心：功能驱动，最小界面，不造屎山。**

- 不引入 UI 组件库（Ant Design、MUI 等），只用 Tailwind CSS + 原生 HTML。
- 不做动画、骨架屏、Toast、自定义弹窗。
- 不做主题切换、国际化（初期中文）。
- 不做响应式（桌面端专用管理后台）。
- 页面数量最小化。

**页面清单（4页）**：

| 页面 | 内容 |
|---|---|
| `/` 概览 | 站点数、模型数、变体数、活跃任务数、最近错误 |
| `/sites` | 站点列表 + 添加/编辑/删除/同步 + 展开查看模型列表 |
| `/variants` | 变体列表 + 添加/编辑/删除 + 绑定模型 |
| `/keys` | API Key 列表 + 创建（一次性明文）+ 撤销 |

**交互规则**：
- 表单提交后刷新列表，不用乐观更新。
- 删除用原生 `confirm()`。
- 错误显示在表单下方，不用 Toast。

---

## 13. 异步任务处理

### 任务状态机

```
pending → processing → completed
       ↘ failed         ↘ (仅结果 URL 过期，状态不变)
       ↘ timeout
processing → failed
processing → timeout
```

合法转换和触发方见第 7 章"任务状态机——合法转换"表格。

### 轮询 Worker

#### 启动恢复（修正版）

```typescript
// 服务启动时执行，分两步：先处理超时，再入队未完成的
async function restoreTasks() {
  const now = Date.now();

  // Step 1：批量标记已超时的任务（不可再轮询）
  await db.update(tasks)
    .set({ status: 'timeout', updated_at: now })
    .where(
      and(
        inArray(tasks.status, ['pending', 'processing']),
        lt(tasks.max_polling_at, now)
      )
    );

  // Step 2：查询仍未完成且未超时的任务，加入队列
  const activeTasks = await db.query.tasks.findMany({
    where: and(
      inArray(tasks.status, ['pending', 'processing']),
      gt(tasks.max_polling_at, now)
    )
  });

  for (const task of activeTasks) {
    worker.enqueue(task);
  }
}
```

#### 轮询循环（修正版）

并发控制：每站点同时轮询上限 5 个，全局上限 20 个。
轮询间隔：按 `max_duration_sec` 动态调整（短任务 5s，长任务指数退避至 60s）。

```typescript
import pLimit from 'p-limit';

const globalLimit = pLimit(20);    // 全局并发上限

// 每 10 秒执行一轮（实际 worker 应用 setInterval + 防重入锁）
async function pollCycle() {
  const now = Date.now();

  // 1. 先标记本轮到期的超时任务
  await db.update(tasks)
    .set({ status: 'timeout', updated_at: now })
    .where(
      and(
        eq(tasks.status, 'processing'),
        lt(tasks.max_polling_at, now)
      )
    );

  // 2. 查询活跃任务（按 last_poll_at 升序，优先处理最久未查的）
  const processing = await db.query.tasks.findMany({
    where: eq(tasks.status, 'processing'),
    orderBy: asc(tasks.last_poll_at),
    limit: 50
  });

  await Promise.all(
    processing.map(task =>
      globalLimit(async () => {
        try {
          const siteResult = await querySiteTask(task);

          // 先更新数据库，再读取最新记录
          await db.update(tasks)
            .set({
              status: siteResult.status,
              result: siteResult.result ?? null,
              result_expires_at: siteResult.result_expires_at ?? null,
              error: siteResult.error ?? null,
              completed_at: siteResult.status === 'completed' ? now : null,
              poll_count: sql`${tasks.poll_count} + 1`,
              last_poll_at: now,
              updated_at: now
            })
            .where(
              and(
                eq(tasks.id, task.id),
                eq(tasks.status, 'processing') // 条件更新，防止并发覆盖
              )
            );

          // 任务完成时，用 DB 里最新数据触发回调
          if (siteResult.status === 'completed' || siteResult.status === 'failed') {
            const updated = await db.query.tasks.findFirst({ where: eq(tasks.id, task.id) });
            if (updated) await scheduleCallback(updated);
          }
        } catch (e) {
          // 单任务轮询失败不影响其他任务
        }
      })
    )
  );
}
```

### 回调通知（修正版）

回调使用**独立投递队列**，与轮询解耦。支持退避重试，最多 5 次。

```typescript
// 触发回调（只负责写投递计划，不直接 fetch）
async function scheduleCallback(task: Task) {
  if (!task.callback_url || task.callback_done) return;

  await db.update(tasks)
    .set({
      callback_next_at: Date.now(),  // 立即投递
      updated_at: Date.now()
    })
    .where(eq(tasks.id, task.id));
}

// 独立的回调投递 worker（每 5 秒跑一次）
async function deliverCallbacks() {
  const now = Date.now();
  const pending = await db.query.tasks.findMany({
    where: and(
      eq(tasks.callback_done, 0),
      isNotNull(tasks.callback_url),
      isNotNull(tasks.callback_next_at),
      lte(tasks.callback_next_at, now),
      lt(tasks.callback_attempts, 5)
    ),
    limit: 20
  });

  for (const task of pending) {
    try {
      const timestamp = now;
      const payload = JSON.stringify({
        event: task.status === 'completed' ? 'task.completed' : 'task.failed',
        id: task.id,
        status: task.status,
        result: task.result,
        error: task.error,
        timestamp
      });

      // HMAC 签名（接收方用 task.callback_secret 验证）
      const sig = task.callback_secret
        ? createHmac('sha256', task.callback_secret).update(payload).digest('hex')
        : undefined;

      const resp = await fetch(task.callback_url!, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sig ? { 'X-OpenHub-Signature': `sha256=${sig}` } : {})
        },
        body: payload,
        signal: AbortSignal.timeout(10000)  // 10 秒超时
      });

      if (resp.ok) {
        await db.update(tasks)
          .set({ callback_done: 1, updated_at: now })
          .where(eq(tasks.id, task.id));
      } else {
        throw new Error(`HTTP ${resp.status}`);
      }
    } catch (e) {
      // 退避策略：1m → 5m → 30m → 2h → 6h
      const backoffMinutes = [1, 5, 30, 120, 360];
      const nextDelay = (backoffMinutes[task.callback_attempts] ?? 360) * 60 * 1000;
      await db.update(tasks)
        .set({
          callback_attempts: sql`${tasks.callback_attempts} + 1`,
          callback_next_at: now + nextDelay,
          updated_at: now
        })
        .where(eq(tasks.id, task.id));
    }
  }
}
```

### 超时处理

- `max_polling_at = created_at + 24 小时`（提交任务时即设置，不依赖 `started_at`）
- 启动恢复和每轮轮询均包含超时检查
- 超时任务如有 `callback_url`，照常触发 `task.failed` 事件（status=timeout 视为失败）
- 结果 URL 过期（`result_expires_at < now`）不改变 status，应在查询接口返回时提示 URL 已过期

---

## 14. 边界条件与风险

### 已知限制

| 限制 | 说明 |
|---|---|
| 流式中途不降级 | SSE 开始后站点断开，直接返回错误，由调用方决定是否重试 |
| 变体单站点绑定 | MVP 阶段一个变体只绑定一个 model 实例 |
| 无计费追踪 | 不记录 token 用量 |
| 无速率限制 | 不对调用方限流，依赖上游 |
| 能力识别准确率 | 目录命中提升 LLM 准确率；视频/音频仍需人工确认 |
| 视频适配器需逐个实现 | 无法通用处理，需要针对每个供应商写适配器 |
| 外部目录覆盖范围 | models.dev 主要覆盖 LLM；图片/音频/视频条目有限，规则匹配仍是主要兜底 |
| Windows 文件名兼容 | models.dev 源码仓库含大量带 `:` 的 TOML 文件名，不能在 Windows 上直接 clone 使用 |

### 潜在风险

1. **同名模型跨站能力差异**：已通过 per-site model instance 建模，但变体切换站点时需人工确认能力匹配。

2. **站点 Key 泄漏**：MASTER_KEY 泄漏会导致所有站点 Key 同时暴露。通过操作系统环境变量保护，不记录日志。

3. **数据库文件权限**：SQLite 文件含加密 Key，设置文件系统权限 600，容器内不公开挂载。

4. **异步任务孤儿**：轮询失败或服务重启后任务卡住。通过启动时恢复 + 超时机制兜底。

5. **模型列表端点不存在**：部分 New API 实例可能禁用 `/v1/models`。需要备用方案（人工录入）。

6. **能力探测产生费用**：如果启用探测策略，可能触发计费。建议默认关闭探测，只用规则匹配。

7. **外部目录 schema 漂移**：models.dev 升级 Zod schema（增删字段或改变字段语义）会导致 OpenHub 的 ETL 解析失败。缓解方案：同步前用 `catalog_sync_runs` 记录 schema hash；检测到结构异常时整批拒绝，保留上一版本目录，不中断现有业务。

8. **目录数据质量**：models.dev 是社区维护项目，部分模型参数（context_window、能力标志）可能滞后或有误。OpenHub 将目录数据只作为"候选建议"而非"事实真相"，一切生效前须管理员确认。

9. **目录删除导致配置消失**：若 models.dev 删除了一条目录记录，OpenHub 不联动删除 `model_catalog` 行，只标记 `source_version` 不一致。已绑定 `catalog_model_id` 的站点实例保留，避免配置意外丢失。

10. **目录同步网络依赖**：生产环境可能无法访问 `models.dev`。OpenHub 发布包内置一份经过校验的快照，完全离线可用；在线同步为可选增强，失败不阻断任何核心功能。

---

## 15. 已确认 / 推测 / 未验证

### 已确认事实

- New API 兼容 OpenAI API 格式（`/v1/models`、`/v1/chat/completions` 等端点存在）。
- OpenAI SDK 的 `baseURL` 参数可以指向任意兼容服务。
- Hono 支持 Node.js / Bun / Cloudflare Workers 多运行时。
- Drizzle ORM 支持 SQLite 和 PostgreSQL，迁移方式相同。
- Node.js 内置 `crypto` 模块支持 AES-256-GCM，无需引入额外依赖。
- models.dev 开源目录提供标准化的 JSON API（`https://models.dev/models.json`），覆盖 100+ 厂商 / 500+ 模型，字段由 Zod strict schema 约束，可稳定消费。
- models.dev 的 `family.ts` 枚举覆盖了 LLM、图片（dall-e/flux/imagen/stable-diffusion/ideogram/recraft）、视频（sora/veo/runway/dream-machine）、音频（whisper/elevenlabs/lyria/melotts）等主要模型族，可直接用于关键词匹配规则的扩充。
- models.dev 使用三层数据分离：`labs/`（厂商元数据）、`models/`（provider-agnostic 规范事实）、`providers/`（服务细节与定价）；OpenHub 只需消费 `models/` 层生成的 JSON，不依赖 providers 定价。
- Windows NTFS 不支持文件名含 `:` 的路径，models.dev 源码仓库中大量 TOML 文件名含 `:`，**不能在 Windows 上直接 clone 使用源码仓库**，必须消费已生成的 JSON API。

### 合理推测

- New API 的 `/v1/models` 响应格式与 OpenAI 一致（`data[].id` 包含模型名）。
- 大多数调用方已在使用 OpenAI SDK，更换 `baseURL` 零改造。
- 不同 New API 站点的响应格式差异主要集中在参数命名和额外字段上，而非整体结构。
- models.dev 目录对主流 LLM 的 context_window、tool_call、reasoning、structured_output 等字段准确率高，可用于自动填充；对新发布的小众模型或视频模型可能存在滞后。
- 目录 family 字段与 OpenHub 现有 FAMILY_DEFAULTS 关键词覆盖互补，合并后可覆盖绝大多数 LLM 站点实例的自动识别。

### 未验证假设

- **假设所有 New API 实例都暴露 `/v1/models` 端点**：需确认是否有站点禁用此端点。
- **假设能力探测不产生费用或费用可忽略**：需确认探测策略。
- **假设视频异步接口可适配**：Sora、Kling、Wan 等的视频接口格式可能完全不同，需要逐个实现适配器，无法通用处理。
- **假设 models.dev JSON API 保持当前 schema 稳定**：若上游进行 breaking change，OpenHub 的 ETL 解析需同步更新；通过 schema hash 检测预警。

---

## 16. 待确认问题

执行前必须回答：

1. **视频异步接口**：目标站点使用哪些视频模型（Sora / Kling / Wan / ...）？各自的任务提交和查询接口格式是什么？是否有站点已提供文档？

2. **能力探测策略**：是否允许在模型发现时发送探测请求来验证能力？如不允许，纯规则匹配的准确率需接受人工修正。

3. **多租户需求**：MVP 阶段是否只需要单用户（一个管理后台账号），还是需要支持多用户隔离？

4. **部署环境**：目标部署平台（本地 Docker / VPS / 云函数 / 边缘）？影响数据库选型和 Key 加密实现。

5. **变体多站点降级**：MVP 是否需要同一个变体绑定多个备用站点自动切换？如需要，需调整数据模型（引入变体组）。

6. **模型发现触发时机**：站点添加时自动触发首次同步，还是需要管理员手动触发？

7. **目录同步策略**：是否允许 OpenHub 在启动时联网从 `models.dev` 拉取最新目录？如果部署在完全离线环境，只使用内置快照是否满足需求？

8. **向导 LLM 配置**：向导的 AI 推断功能依赖一个已配置的 LLM 变体。MVP 阶段是否可以接受在没有 LLM 变体时向导降级为纯手动配置？

---

## 17. 实施路线图与执行手册

> 本章面向**直接执行者**（包括大上下文模型），包含完整的文件创建顺序、每个 Phase 的入口/出口条件、数据库迁移命令、验证步骤和调试方法。执行前确保阅读第 15-16 章的未验证假设和待确认问题。

### 执行总览

| Phase | 目标 | 核心文件数 | 预计工时 |
|---|---|---|---|
| Phase 0 | 项目脚手架 | ~5 | 1-2 天 |
| Phase 1 | 可运行核心（MVP） | ~25 | 3-4 周 |
| Phase 2 | 目录同步 + 匹配 | ~15 | 2-3 周 |
| Phase 3 | 多模态 + 高级能力 | ~20 | 3-4 周 |

---

### Phase 0 — 项目脚手架

**目标**：建立 monorepo 结构、TypeScript 配置、数据库 ORM、Git hooks。

**入口条件**：无，任何人可以从零开始执行。

**出口条件**：
- `pnpm install` 成功
- `pnpm dev` 启动后端，无编译错误
- `pnpm web:dev` 启动前端，无编译错误
- 数据库迁移脚本可执行（`pnpm db:push`）

#### 执行步骤

**Step 0.1** 创建 monorepo 根目录和 `package.json`：

```bash
mkdir openhub && cd openhub
cat > package.json << 'EOF'
{
  "name": "openhub",
  "private": true,
  "scripts": {
    "dev": "pnpm --filter @openhub/server dev",
    "web:dev": "pnpm --filter @openhub/web dev",
    "db:push": "pnpm --filter @openhub/server db:push",
    "db:migrate": "pnpm --filter @openhub/server db:migrate",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "pnpm": "^9.0.0"
  }
}
EOF
```

**Step 0.2** 创建 `pnpm-workspace.yaml`：

```yaml
packages:
  - "packages/*"
```

**Step 0.3** 创建 `packages/server/package.json`（Bun 运行时 + Hono + Drizzle + SQLite）：

```bash
mkdir -p packages/server/src
cat > packages/server/package.json << 'EOF'
{
  "name": "@openhub/server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun --watch src/index.ts",
    "start": "bun src/index.ts",
    "db:push": "drizzle-kit push",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "hono": "^4.5.0",
    "@hono/node-server": "^1.13.0",
    "@hono/zod-openapi": "^0.14.0",
    "drizzle-orm": "^0.33.0",
    "better-sqlite3": "^11.2.0",
    "zod": "^3.23.0",
    "nanoid": "^5.0.7",
    "@openhub/catalog": "workspace:*"
  },
  "devDependencies": {
    "bun-types": "^1.1.0",
    "drizzle-kit": "^0.24.0",
    "@types/better-sqlite3": "^7.6.11",
    "typescript": "^5.5.0"
  }
}
EOF
```

**Step 0.4** 创建 `packages/server/tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["bun-types"]
  },
  "include": ["src/**/*"]
}
```

**Step 0.5** 创建 `packages/catalog/package.json`（存放 upstream 复用代码和快照）：

```bash
mkdir -p packages/catalog/src
cat > packages/catalog/package.json << 'EOF'
{
  "name": "@openhub/catalog",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    "./upstream": "./src/upstream/index.ts",
    "./snapshot": "./src/snapshot.json"
  },
  "devDependencies": {
    "typescript": "^5.5.0"
  }
}
EOF
```

**Step 0.6** 创建 `packages/web/package.json`（React + Vite 管理后台）：

```bash
mkdir -p packages/web/src
cat > packages/web/package.json << 'EOF'
{
  "name": "@openhub/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.26.0",
    "zustand": "^4.5.0",
    "@tanstack/react-query": "^5.51.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0"
  }
}
EOF
```

**Step 0.7** 创建 `drizzle.config.ts`：

```typescript
// packages/server/src/db/drizzle.config.ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: "./data/openhub.db",
  },
});
```

**Step 0.8** 安装依赖并验证编译：

```bash
pnpm install
pnpm typecheck        # 应无错误
pnpm db:push          # 创建空数据库文件 data/openhub.db
```

---

### Phase 1 — 可运行核心（MVP）

**目标**：添加站点 → 发现模型 → LLM 对话调用，可跑通全链路。

**入口条件**：Phase 0 完成，`pnpm dev` 无编译错误。

**出口条件**：
- 管理员可在 UI 创建站点（填写 URL + Key）
- 调用方用 OpenHub 虚拟 Key 发起 chat/completions 请求，OpenHub 正确转发到目标站点并返回响应
- `/v1/models` 聚合所有站点的模型列表

#### 依赖关系图（文件创建顺序）

```
Phase 1 文件依赖顺序：

1.  数据层（无依赖）
   └─ schema.ts                    # 定义所有表结构
   └─ index.ts (db)               # Drizzle 实例导出

2.  加密层（依赖 1）
   └─ crypto.ts                   # AES-256-GCM 加密/解密 Key

3.  适配器基础（无依赖）
   └─ adapter.ts                  # Adapter 接口定义
   └─ adapters/openai.ts         # OpenAI 兼容适配器（Phase 1 唯一）

4.  路由核心（依赖 1、3）
   └─ router.ts                   # 路由分发（variant → model → adapter）
   └─ middleware/auth.ts         # Hub 虚拟 Key 鉴权

5.  API 路由（依赖 1、2、4）
   └─ routes/sites.ts             # 站点 CRUD
   └─ routes/keys.ts             # Key CRUD
   └─ routes/models.ts           # /v1/models
   └─ routes/chat.ts             # /v1/chat/completions
   └─ routes/embeddings.ts       # /v1/embeddings

6.  管理后台 API（依赖 1、2、5）
   └─ routes/admin/sites.ts       # 管理端站点管理
   └─ routes/admin/models.ts      # 管理端模型列表

7.  管理后台前端（无依赖）
   └─ web/src/pages/Sites.tsx
   └─ web/src/pages/Models.tsx
   └─ web/src/pages/Keys.tsx
   └─ web/src/App.tsx
```

#### 执行步骤

**Step 1.1** 创建数据库 schema（`packages/server/src/db/schema.ts`）：

```typescript
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// --- 站点 ---
export const sites = sqliteTable("sites", {
  id: text("id").primaryKey(),           // nanoid
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  apiKeyEnc: text("api_key_enc").notNull(), // AES-256-GCM 加密
  apiKeyIv: text("api_key_iv").notNull(),   // 加密 IV
  adapterId: text("adapter_id").notNull().default("openai"),
  status: text("status", { enum: ["active", "error", "disabled"] })
    .notNull().default("active"),
  errorCount: integer("error_count").notNull().default(0),
  lastError: text("last_error"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull().default(sql`(unixepoch())`),
});

// --- 站点模型（每个站点发现的每个模型） ---
export const models = sqliteTable("models", {
  id: text("id").primaryKey(),
  siteId: text("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  remoteId: text("remote_id").notNull(),   // 站点返回的原始 model id
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull().default(sql`(unixepoch())`),
});

// --- 虚拟 Key ---
export const virtualKeys = sqliteTable("virtual_keys", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),  // 存储 hash，不存储明文
  name: text("name").notNull(),
  allowedVariantIds: text("allowed_variant_ids"), // JSON array
  rateLimit: integer("rate_limit"),     // 每分钟请求数限制
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull().default(sql`(unixepoch())`),
  expiresAt: integer("expires_at", { mode: "timestamp" }),
});

// --- 变体 ---
export const variants = sqliteTable("variants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  modelId: text("model_id").notNull().references(() => models.id, { onDelete: "cascade" }),
  adapterConfig: text("adapter_config"),  // JSON，适配器特定配置
  paramMapping: text("param_mapping"),    // JSON，参数映射配置
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull().default(sql`(unixepoch())`),
});

// --- 站点 Key ---
export const keys = sqliteTable("keys", {
  id: text("id").primaryKey(),
  siteId: text("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  key: text("key").notNull().unique(),
  prefix: text("prefix").notNull(),   // Key 前缀（脱敏展示用）
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull().default(sql`(unixepoch())`),
  expiresAt: integer("expires_at", { mode: "timestamp" }),
});
```

**Step 1.2** 创建加密模块（`packages/server/src/lib/crypto.ts`）：

```typescript
const ALGORITHM = "aes-256-gcm";

function deriveKey(password: string, salt: Uint8Array): CryptoKey {
  return crypto.subtle;
}

// 加密 API Key
export function encryptApiKey(plaintext: string, password: string): {
  ciphertext: string;
  iv: string;
  tag: string;
} {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password)),
    ALGORITHM,
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return {
    ciphertext: Buffer.from(encrypted).toString("base64"),
    iv: Buffer.from(iv).toString("base64"),
    tag: Buffer.from(salt).toString("base64"),
  };
}

// 解密 API Key
export async function decryptApiKey(
  ciphertext: string,
  iv: string,
  _tag: string, // GCM tag 内嵌在 ciphertext 末尾
  password: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password)),
    ALGORITHM,
    false,
    ["decrypt"],
  );
  const decrypted = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv: Buffer.from(iv, "base64") },
    key,
    Buffer.from(ciphertext, "base64"),
  );
  return new TextDecoder().decode(decrypted);
}
```

> **注意**：实际生产中 password 应来自环境变量 `OPENHUB_MASTER_KEY`，MVP 阶段可简化为固定字符串（详见第 11 章安全设计）。

**Step 1.3** 创建适配器接口（`packages/server/src/engine/adapter.ts`）：

```typescript
export interface ChatRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  // ... 其他 OpenAI 标准字段
}

export interface ChatResponse {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export interface Adapter {
  id: string;
  forwardChat(params: {
    request: ChatRequest;
    targetUrl: string;
    apiKey: string;
  }): Promise<ChatResponse>;

  forwardChatStream?(params: {
    request: ChatRequest;
    targetUrl: string;
    apiKey: string;
  }): Promise<ReadableStream>;
}
```

**Step 1.4** 创建 OpenAI 适配器（`packages/server/src/engine/adapters/openai.ts`）：

```typescript
import type { Adapter, ChatRequest, ChatResponse } from "../adapter.ts";

export const openaiAdapter: Adapter = {
  id: "openai",

  async forwardChat({ request, targetUrl, apiKey }) {
    const url = `${targetUrl.replace(/\/$/, "")}/v1/chat/completions`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
    }

    return response.json() as Promise<ChatResponse>;
  },

  async forwardChatStream({ request, targetUrl, apiKey }) {
    const url = `${targetUrl.replace(/\/$/, "")}/v1/chat/completions`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ ...request, stream: true }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error ${response.status}`);
    }

    return response.body!;
  },
};
```

**Step 1.5** 创建 Hub Key 鉴权中间件（`packages/server/src/middleware/auth.ts`）：

```typescript
import type { Context, Next } from "hono";
import { keys } from "../db/schema.ts";
import { db } from "../db/index.ts";

export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: { message: "Missing or invalid Authorization header" } }, 401);
  }

  const token = authHeader.slice(7);
  const hashedToken = await hashToken(token);

  const [keyRecord] = await db
    .select()
    .from(keys)
    .where(eq(keys.key, hashedToken))
    .limit(1);

  if (!keyRecord) {
    return c.json({ error: { message: "Invalid API key" } }, 401);
  }

  c.set("hubKey", keyRecord);
  return next();
}
```

**Step 1.6** 创建站点发现逻辑（`packages/server/src/engine/discover.ts`）：

```typescript
import { models } from "../db/schema.ts";
import { db } from "../db/index.ts";

interface DiscoveredModel {
  id: string;
  object: string;
  created: number;
  name: string;
  owned_by: string;
}

export async function discoverModels(siteId: string, baseUrl: string, apiKey: string) {
  const url = `${baseUrl.replace(/\/$/, "")}/v1/models`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to discover models: ${response.status}`);
  }

  const data = await response.json() as { data: DiscoveredModel[] };

  for (const model of data.data) {
    await db.insert(models).values({
      id: nanoid(),
      siteId,
      remoteId: model.id,
      name: model.id,
    }).onConflictDoNothing();
  }
}
```

**Step 1.7** 创建聊天路由（`packages/server/src/routes/chat.ts`）：

```typescript
import { Hono } from "hono";
import { variants, models, sites } from "../db/schema.ts";
import { db } from "../db/index.ts";
import { eq } from "drizzle-orm";
import { openaiAdapter } from "../engine/adapters/openai.ts";
import { decryptApiKey } from "../lib/crypto.ts";

const chat = new Hono();

chat.post("/v1/chat/completions", async (c) => {
  const body = await c.req.json();
  const { model: variantId } = body;

  // 1. 根据变体 ID 查找模型实例
  const [variant] = await db.select().from(variants).where(eq(variants.id, variantId)).limit(1);
  if (!variant) return c.json({ error: { message: "Model not found" } }, 404);

  const [modelRecord] = await db.select().from(models).where(eq(models.id, variant.modelId)).limit(1);
  const [site] = await db.select().from(sites).where(eq(sites.id, modelRecord.siteId)).limit(1);

  // 2. 解密站点 API Key
  const apiKey = await decryptApiKey(
    site.apiKeyEnc,
    site.apiKeyIv,
    "",
    process.env.OPENHUB_MASTER_KEY ?? "dev-key",
  );

  // 3. 选择适配器并转发
  const adapter = openaiAdapter; // Phase 1 只有 openai
  const response = await adapter.forwardChat({
    request: body,
    targetUrl: site.baseUrl,
    apiKey,
  });

  return c.json(response);
});

export default chat;
```

**Step 1.8** 创建主入口（`packages/server/src/index.ts`）：

```typescript
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import chatRoutes from "./routes/chat.ts";
import adminRoutes from "./routes/admin/sites.ts";

const app = new Hono();

app.use("*", cors());
app.route("/", chatRoutes);
app.route("/admin", adminRoutes);

const port = Number(process.env.PORT ?? 3000);
console.log(`OpenHub server running on port ${port}`);

serve({ fetch: app.fetch, port });
```

**Step 1.9** 创建管理后台前端基础页面（`packages/web/src/App.tsx`）：

```tsx
import { BrowserRouter, Routes, Route } from "react-router-dom";
import SitesPage from "./pages/Sites.tsx";
import ModelsPage from "./pages/Models.tsx";
import KeysPage from "./pages/Keys.tsx";

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex h-screen bg-gray-100">
        <aside className="w-56 bg-white border-r">
          <h1 className="p-4 font-bold text-lg">OpenHub</h1>
          <nav className="flex flex-col gap-1 p-2">
            <a href="/admin/sites" className="px-3 py-2 rounded hover:bg-gray-100">站点</a>
            <a href="/admin/models" className="px-3 py-2 rounded hover:bg-gray-100">模型</a>
            <a href="/admin/keys" className="px-3 py-2 rounded hover:bg-gray-100">密钥</a>
          </nav>
        </aside>
        <main className="flex-1 p-6 overflow-auto">
          <Routes>
            <Route path="/admin/sites" element={<SitesPage />} />
            <Route path="/admin/models" element={<ModelsPage />} />
            <Route path="/admin/keys" element={<KeysPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
```

**Step 1.10** 启动并验证全链路：

```bash
# 终端 1：启动后端
pnpm dev

# 终端 2：curl 验证
# 1) 创建站点（管理员 API）
curl -X POST http://localhost:3000/admin/sites \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Site","baseUrl":"https://api.openai.com","apiKey":"sk-xxx","adapterId":"openai"}'

# 2) 获取 /v1/models
curl http://localhost:3000/v1/models \
  -H "Authorization: Bearer $HUB_KEY"

# 3) 发起 chat 请求
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $HUB_KEY" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"Hello"}]}'
```

---

### Phase 2 — 目录同步 + 能力匹配

**目标**：接入 models.dev 目录，实现模型能力自动发现和四步匹配。

**入口条件**：Phase 1 完成，`/v1/chat/completions` 全链路可通。

**出口条件**：
- `pnpm db:push` 成功创建 `model_catalog`、`catalog_sync_runs` 表
- `GET /admin/catalog/sync` 返回 `status: ok`，`catalog_sync_runs` 记录数 >= 1
- 站点注册后，站内模型自动写入 `catalog_model_id`（exact 匹配）

#### 执行步骤

**Step 2.1** 创建目录表 schema 扩展（`packages/server/src/db/schema-catalog.ts`）：

```typescript
// 新增表
export const modelCatalog = sqliteTable("model_catalog", {
  id: text("id").primaryKey(),              // 如 "openai/gpt-4o"
  name: text("name").notNull(),
  description: text("description"),
  family: text("family"),
  releaseDate: text("release_date"),        // YYYY-MM-DD 或 YYYY-MM
  lastUpdated: text("last_updated"),
  openWeights: integer("open_weights", { mode: "boolean" }),
  contextLimit: integer("context_limit"),
  inputLimit: integer("input_limit"),
  outputLimit: integer("output_limit"),
  modalitiesIn: text("modalities_in"),      // JSON array
  modalitiesOut: text("modalities_out"),
  reasoning: integer("reasoning", { mode: "boolean" }),
  toolCall: integer("tool_call", { mode: "boolean" }),
  structuredOutput: integer("structured_output", { mode: "boolean" }),
  rawPayload: text("raw_payload"),          // 完整上游 JSON
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull().default(sql`(unixepoch())`),
});

export const catalogSyncRuns = sqliteTable("catalog_sync_runs", {
  id: text("id").primaryKey(),
  status: text("status", { enum: ["running", "success", "failed"] }).notNull(),
  totalRecords: integer("total_records").default(0),
  addedRecords: integer("added_records").default(0),
  updatedRecords: integer("updated_records").default(0),
  errorMessage: text("error_message"),
  syncStartedAt: integer("sync_started_at", { mode: "timestamp" }).notNull(),
  syncCompletedAt: integer("sync_completed_at", { mode: "timestamp" }),
});
```

**Step 2.2** 创建 `packages/server/src/engine/catalog/` 目录结构和 upstream 复制文件（详见第 20 章）：

```
packages/server/src/engine/catalog/
  upstream/
    family.ts          # 复制 ModelFamilyValues + inferKimiFamily
    schema.ts          # 复制 Zod 字段定义
    stable.ts          # 复制 stable 函数
    omit.ts            # 复制 applyOmit
  catalog-to-model.ts   # 自研
  diff.ts              # 自研（使用 stable）
  preserve.ts          # 自研
  sync.ts              # 自研：核心同步逻辑
  matcher.ts           # 自研：四步匹配
  capability-map.ts    # 自研
```

**Step 2.3** 创建同步核心逻辑（`packages/server/src/engine/catalog/sync.ts`）：

```typescript
import { modelCatalog, catalogSyncRuns } from "../../db/schema-catalog.ts";
import { CatalogItemSchema } from "./upstream/schema.ts";
import { stable } from "./upstream/stable.ts";
import { db } from "../../db/index.ts";
import { nanoid } from "nanoid";
import { sql } from "drizzle-orm";

const CATALOG_URL = "https://models.dev/api/v0/models.json";

export async function syncCatalog(): Promise<void> {
  const runId = nanoid();
  const startedAt = new Date();

  await db.insert(catalogSyncRuns).values({
    id: runId,
    status: "running",
    syncStartedAt: startedAt,
  });

  try {
    // 1. 拉取 JSON
    const response = await fetch(CATALOG_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw = await response.json() as unknown;

    // 2. Zod 校验
    const parsed = CatalogResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Schema validation failed: ${parsed.error.message}`);
    }

    // 3. 计算 diff
    const existing = await db.select({ id: modelCatalog.id, raw: modelCatalog.rawPayload })
      .from(modelCatalog);
    const existingMap = new Map(existing.map(r => [r.id, r.raw]));

    let added = 0, updated = 0;
    for (const item of parsed.data.data) {
      const raw = JSON.stringify(item);
      const oldRaw = existingMap.get(item.id);

      if (!oldRaw) {
        added++;
        await db.insert(modelCatalog).values({ id: item.id, rawPayload: raw, ...catalogFields(item) });
      } else if (stable(JSON.parse(oldRaw)) !== stable(item)) {
        updated++;
        await db.update(modelCatalog).set({ rawPayload: raw, ...catalogFields(item) }).where(eq(modelCatalog.id, item.id));
      }
    }

    // 4. 更新运行记录
    await db.update(catalogSyncRuns)
      .set({ status: "success", totalRecords: parsed.data.data.length, addedRecords: added, updatedRecords: updated, syncCompletedAt: new Date() })
      .where(eq(catalogSyncRuns.id, runId));

  } catch (err) {
    await db.update(catalogSyncRuns)
      .set({ status: "failed", errorMessage: String(err), syncCompletedAt: new Date() })
      .where(eq(catalogSyncRuns.id, runId));
    throw err;
  }
}

function catalogFields(item: z.infer<typeof CatalogItemSchema>) {
  return {
    name: item.name,
    description: item.description,
    family: item.family,
    releaseDate: item.release_date,
    contextLimit: item.limit?.context,
    inputLimit: item.limit?.input,
    outputLimit: item.limit?.output,
    modalitiesIn: item.modalities?.input ? JSON.stringify(item.modalities.input) : null,
    modalitiesOut: item.modalities?.output ? JSON.stringify(item.modalities.output) : null,
    reasoning: item.reasoning ?? null,
    toolCall: item.tool_call ?? null,
    structuredOutput: item.structured_output ?? null,
    openWeights: item.open_weights ?? null,
    updatedAt: new Date(),
  };
}
```

**Step 2.4** 创建四步匹配器（`packages/server/src/engine/catalog/matcher.ts`）：

```typescript
// packages/server/src/engine/catalog/matcher.ts

export type MatchResult = {
  catalogModelId: string | null;
  confidence: number;        // 0.0 - 1.0
  source: "exact" | "normalized" | "alias" | "keyword" | null;
};

export async function matchModel(
  modelName: string,
): Promise<MatchResult> {
  // Step 1: Exact match
  const [exact] = await db.select({ id: modelCatalog.id })
    .from(modelCatalog).where(eq(modelCatalog.id, modelName)).limit(1);
  if (exact) return { catalogModelId: exact.id, confidence: 1.0, source: "exact" };

  // Step 2: Normalized match (lowercase, trim, replace _/- with space)
  const normalized = normalize(modelName);
  const [norm] = await db.select({ id: modelCatalog.id, name: modelCatalog.name })
    .from(modelCatalog).where(eq(sql`LOWER(REPLACE(REPLACE(id, '_', '-'), '/', '-'))`, normalized)).limit(1);
  if (norm) return { catalogModelId: norm.id, confidence: 0.95, source: "normalized" };

  // Step 3: Alias match (model_catalog_alias 表)
  const [alias] = await db.select({ catalogId: modelCatalogAlias.catalogId })
    .from(modelCatalogAlias).where(eq(modelCatalogAlias.alias, modelName.toLowerCase())).limit(1);
  if (alias) return { catalogModelId: alias.catalogId, confidence: 0.90, source: "alias" };

  // Step 4: Keyword match (family 关键词，详见第 5 章规则库)
  const matched = await keywordMatch(modelName);
  if (matched) return { catalogModelId: matched.id, confidence: 0.70, source: "keyword" };

  return { catalogModelId: null, confidence: 0, source: null };
}

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/[_\-\/]/g, " ").replace(/\s+/g, " ");
}

async function keywordMatch(modelName: string): Promise<{ id: string } | null> {
  // 读取 DESIGN.md 第 5 章规则库实现
  // 简化为 family 关键词 + inferKimiFamily 模式
  const { inferKimiFamily } = await import("./upstream/family.ts");
  const inferred = inferKimiFamily(modelName);
  if (inferred) {
    const [found] = await db.select({ id: modelCatalog.id })
      .from(modelCatalog).where(eq(modelCatalog.family, inferred)).limit(1);
    return found ?? null;
  }
  return null;
}
```

**Step 2.5** 创建模型发现后自动匹配逻辑（`packages/server/src/engine/catalog/match-after-discover.ts`）：

```typescript
// 在 discover.ts 的 discoverModels 函数末尾调用
export async function matchDiscoveredModels(siteId: string) {
  const discovered = await db.select().from(models).where(eq(models.siteId, siteId));
  for (const model of discovered) {
    if (model.catalogModelId) continue; // 已匹配，跳过

    const result = await matchModel(model.name);
    if (result.catalogModelId) {
      await db.update(models)
        .set({
          catalogModelId: result.catalogModelId,
          catalogMatchSource: result.source,
          catalogMatchConfidence: result.confidence,
          catalogSyncedAt: new Date(),
        })
        .where(eq(models.id, model.id));
    }
  }
}
```

**Step 2.6** 创建同步 API 路由（`packages/server/src/routes/admin/catalog.ts`）：

```typescript
import { Hono } from "hono";
import { syncCatalog } from "../../engine/catalog/sync.ts";
import { catalogSyncRuns } from "../../db/schema-catalog.ts";
import { db } from "../../db/index.ts";

const catalog = new Hono();

// GET /admin/catalog/sync — 触发同步
catalog.post("/sync", async (c) => {
  try {
    await syncCatalog();
    return c.json({ status: "ok", message: "Sync completed" });
  } catch (err) {
    return c.json({ status: "error", message: String(err) }, 500);
  }
});

// GET /admin/catalog/runs — 查询最近同步记录
catalog.get("/runs", async (c) => {
  const runs = await db.select().from(catalogSyncRuns)
    .orderBy(desc(catalogSyncRuns.syncStartedAt)).limit(10);
  return c.json({ data: runs });
});

export default catalog;
```

**Step 2.7** 验证同步流程：

```bash
# 1. 首次同步
curl -X POST http://localhost:3000/admin/catalog/sync

# 2. 检查同步记录
curl http://localhost:3000/admin/catalog/runs

# 3. 检查目录条目数
# 应返回 > 600 条记录
curl http://localhost:3000/admin/models | jq '.data | length'

# 4. 检查某个模型的 catalog_match_source
curl "http://localhost:3000/admin/models?site_id=$SITE_ID" | jq '.data[0].catalogMatchSource'
```

---

### Phase 3 — 多模态 + 高级能力

**目标**：完善适配器生态、异步任务、变体系统、参数映射、向导。

**入口条件**：Phase 2 完成，目录同步稳定运行。

**出口条件**：
- 图片生成请求可正确路由到图片适配器（SSE 或轮询返回结果）
- 向导可引导配置一个视频模型并生成可用变体
- 参数映射可正确转换站点特有参数

#### 执行步骤（简略，完整实现见对应章节）

| 步骤 | 文件路径 | 依赖 |
|---|---|---|
| 3.1 | `src/engine/adapters/image.ts` | Phase 1 adapter.ts |
| 3.2 | `src/engine/adapters/audio.ts` | Phase 1 adapter.ts |
| 3.3 | `src/engine/adapters/video.ts` | Phase 1 adapter.ts |
| 3.4 | `src/engine/tasks/worker.ts` | Phase 1 db schema |
| 3.5 | `src/routes/admin/wizard.ts` | Phase 2 matcher.ts |
| 3.6 | `src/engine/param-mapper.ts` | Phase 1 adapter.ts |
| 3.7 | `src/engine/variant-router.ts` | Phase 1 router.ts 升级 |

详细实现参照 DESIGN.md 第 8-9、13、18 章对应设计。

---

### 调试与验证清单

每个 Phase 完成后，执行以下验证步骤：

#### Phase 0 验证

```bash
pnpm install                    # 无报错
pnpm typecheck                  # 无错误输出
pnpm db:push                    # data/openhub.db 创建成功
```

#### Phase 1 验证

```bash
# 启动服务
pnpm dev &

# 1. 创建站点
SITE_ID=$(curl -s -X POST http://localhost:3000/admin/sites \
  -H "Content-Type: application/json" \
  -d '{"name":"OpenAI","baseUrl":"https://api.openai.com","apiKey":"'$OPENAI_KEY'"}' | jq -r '.id')

# 2. 发现模型
curl -X POST "http://localhost:3000/admin/sites/$SITE_ID/discover"

# 3. 获取模型列表
curl http://localhost:3000/v1/models | jq '.data | length'   # 应 > 0

# 4. chat 请求
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"1+1=?"}]}' | jq '.choices[0].message.content'
```

#### Phase 2 验证

```bash
# 1. 触发目录同步
curl -X POST http://localhost:3000/admin/catalog/sync

# 2. 检查同步状态
curl http://localhost:3000/admin/catalog/runs | jq '.data[0].status'  # 应为 "success"

# 3. 检查目录条目数
curl "http://localhost:3000/admin/models?site_id=$SITE_ID" | \
  jq '[.data[] | select(.catalogMatchSource != null)] | length'  # 应 > 0

# 4. 检查 exact 匹配率（GPT 系列应该大部分 exact 匹配）
curl "http://localhost:3000/admin/models?site_id=$SITE_ID" | \
  jq '[.data[] | select(.catalogMatchSource == "exact")] | length'
```

#### Phase 3 验证

```bash
# 1. 图片生成请求
curl -X POST http://localhost:3000/v1/images/generations \
  -H "Content-Type: application/json" \
  -d '{"model":"dall-e-3","prompt":"a cute cat"}' | jq '.data[0].url'

# 2. 触发向导（status=unknown 模型）
curl -X POST "http://localhost:3000/admin/models/$UNKNOWN_MODEL_ID/wizard" | jq '.steps'

# 3. 参数映射验证（将 temperature 映射为站点特有字段）
# 对比直接调用站点 vs 通过 OpenHub 调用，输出应一致
```

---

### 给大上下文模型的执行说明

如果你是 236k 上下文的大模型，请按以下顺序执行：

1. **先读 DESIGN.md 全文**（本文件共 3170 行），重点关注：
   - 第 7 章（数据模型）：理解所有表结构
   - 第 10 章（API 设计）：理解所有接口路径
   - 第 17 章（本章）：理解执行顺序
   - 第 19 章（目录同步）：理解 ETL 细节
   - 第 20 章（源码复用）：理解哪些代码可以直接复制

2. **按 Phase 顺序执行**，每个 Phase 完成后执行"调试与验证清单"中的命令

3. **不要跳 Phase**。Phase 2 依赖 Phase 1 的 `/v1/chat/completions` 全链路可通，Phase 3 依赖 Phase 2 的目录同步可运行

4. **遇到错误时**：
   - 优先检查 schema 是否匹配（运行 `pnpm db:push`）
   - 检查 TypeScript 类型（运行 `pnpm typecheck`）
   - 查看服务器日志（`pnpm dev` 输出）
   - 必要时回退到上一步的已知正常状态

5. **遇到未验证假设**（第 16 章）时，先按默认选项执行，完成 Phase 后再处理

---

## 18. 模型引导配置向导

本章描述"模型引导配置向导"功能的设计。该功能面向模型已发现但能力未确认的场景（尤其是视频、非标模型），通过 LLM 辅助推断 + 交互式确认，帮助管理员快速将一个陌生模型配置成可用变体，无需手动查阅供应商文档。

### 设计背景

模型同步后，LLM 模型通常可以被规则库精确匹配，自动生成变体。但以下场景无法自动处理：

- 视频模型名称无规律（如 `seedance3344`、`jimeng-v2-pro`）
- 站点对供应商模型做了二次封装（如 `my-video-01` 指向 Kling）
- 模型参数（分辨率、比例、时长）与官方文档有出入
- 新模型尚未录入内置规则库

向导通过"自动推断 → 人工确认"解决上述问题，生成的变体与手动配置完全等价。

---

### 触发时机

以下情况自动引导用户进入向导：

| 触发条件 | 说明 |
|---|---|
| `models.status = 'unknown'` | 能力识别引擎无法匹配的模型 |
| `models.adapter_id = 'unknown'` | 视频模型未找到匹配适配器 |
| 管理员在模型列表点击"配置向导" | 任意时刻手动进入 |

向导完成后，模型状态更新为 `active`，同时生成一条对应的 `variants` 记录。

---

### 官方模型目录（Model Catalog）

向导的推断依据来自 `model_catalog` 数据库表（详见第 7 章），不再是硬编码的静态 JSON 文件。

**数据源两级架构**：

| 层级 | 内容 | 更新方式 |
|---|---|---|
| **内置快照**（`packages/server/src/engine/capability/catalog-snapshot.json`）| 发布时附带的经过校验的目录快照，保证离线可用 | 随代码发布更新 |
| **数据库镜像**（`model_catalog` 表） | 由同步任务写入，可在线更新 | 自动同步（第 19 章）或首次启动时从快照导入 |

快照在服务启动时以 `INSERT OR IGNORE` 方式导入，不会覆盖在线同步已写入的新版本数据。

**向导从数据库查询目录的接口**：

```typescript
// GET /admin/catalog/search?q=seedance&limit=10
interface CatalogSearchResult {
  id: string;               // 如 "openai/gpt-5"
  name: string;             // "GPT-5"
  lab_name: string;         // "OpenAI"
  family?: string;          // "gpt"
  modalities_in: string[];  // ["text","image"]
  modalities_out: string[]; // ["text"]
  suggested_endpoint_caps: string[];  // 映射后的能力建议
  context_limit?: number;
  output_limit?: number;
  reasoning_options?: unknown;
  source_version: string;   // 目录版本 hash
}
```

**向导展示时，目录候选分三类来源**（显示来源徽章）：

- `🗄 数据库目录`：在线同步后的最新数据
- `📦 内置快照`：随版本发布的快照（离线可用）
- `✏️ 人工录入`：管理员手动添加的补充条目

**视频/音频模型目录补充**：

models.dev 主要覆盖 LLM，视频/音频/图片模型需要 OpenHub 自行补充。补充条目存入同一张 `model_catalog` 表，`source_url` 设为 `openhub:builtin`，`lab_id` 按供应商设定：

```json
[
  {
    "id": "kling/kling-v1",
    "lab_id": "kling",
    "lab_name": "快手可灵",
    "name": "可灵 v1",
    "family": null,
    "modalities_in": ["text", "image"],
    "modalities_out": ["video"],
    "source_url": "openhub:builtin"
  },
  {
    "id": "jimeng/seedance-v1",
    "lab_id": "jimeng",
    "lab_name": "字节即梦",
    "name": "Seedance v1",
    "family": null,
    "modalities_in": ["text", "image"],
    "modalities_out": ["video"],
    "source_url": "openhub:builtin"
  }
]
```

这些补充条目不参与 models.dev 同步循环，不会被在线同步覆盖。

---

### LLM 推断服务

向导在 Step 1 调用 LLM 推断模型身份。推断前，引擎先完成五层识别（第 5 章），已有确定性匹配的模型不再调用 LLM 推断（节省 token）。

**调用时机**：用户进入向导后，后端自动触发一次推断，结果缓存在向导 session 中，不重复调用。

**输入**：

```
模型原始名称：{raw_name}
站点 base_url：{site.base_url}（仅域名，不含 Key）

五层识别结果（预填参考）：
  - 识别来源：{catalog_match_source}（如 keyword / none）
  - 匹配置信度：{catalog_match_confidence}
  - 推断 modality：{suggested_modality}

已知官方模型目录（摘要）：
{catalog_summary}   ← 只传 id + name + family，不传完整参数，控制 token 用量

请判断：
1. 此模型最可能对应官方目录中的哪个模型？给出候选列表（最多 3 个），按匹配度排序。
2. 如果无法匹配，推断其 modality（llm/image/audio/video）。
3. 简要说明推断依据。
```

**输出（结构化）**：

```typescript
interface InferenceResult {
  matched: boolean;
  candidates: Array<{
    catalog_id: string;
    display_name: string;
    confidence: "high" | "medium" | "low";
    reason: string;
  }>;
  fallback_modality?: "llm" | "image" | "audio" | "video";
}
```

**调用方式**：通过 OpenHub 自身的 `/v1/chat/completions` 接口，指定一个已配置的 LLM 变体（管理员在系统设置中指定"向导 LLM 变体"）。若未配置，向导跳过 LLM 推断，直接展示五层识别结果供用户确认。

---

### 向导 UI 流程（4 步）

#### Step 1 — 模型身份确认

**目标**：确认这个模型是哪个已知官方模型，或标记为全新模型。

展示来源分三层（按优先级排列）：五层识别引擎结果、LLM 推断候选、全目录手动搜索。

```
┌─────────────────────────────────────────────────────────────────┐
│  配置向导  1/4 — 模型身份                                          │
│                                                                   │
│  原始模型名：seedance3344                                          │
│  所属站点：api.example.com                                        │
│  识别来源：关键词匹配  |  置信度：中                               │
│                                                                   │
│  推断候选（点击选择，或选择"都不是"）：                             │
│                                                                   │
│  ◉ 即梦 Seedance v1  [jimeng/seedance-v1]     [高置信度] [📦 快照] │
│     推断依据：名称含 "seedance"；即梦旗下视频生成模型               │
│     能力建议：video_generation  |  输出：video                    │
│                                                                   │
│  ○ 可灵 v1  [kling/kling-v1]                  [低置信度] [📦 快照] │
│     推断依据：同为视频生成模型，但名称特征不匹配                    │
│                                                                   │
│  ──────────────────────────────────────────────────────────────  │
│  ○ 都不是，搜索目录                                                │
│     → 全文搜索 model_catalog（支持名称、family、lab_name）         │
│                                                                   │
│  ○ 这是一个全新模型（官方目录中没有）                               │
│     → 进入全手动配置流程                                           │
│                                                                   │
│                              [取消]  [下一步 →]                   │
└─────────────────────────────────────────────────────────────────┘
```

**结果**：
- 选择已知模型 → Step 2 根据目录数据预填能力，用户可修改；同时记录 `catalog_model_id`。
- 选择全新模型 → Step 2 全部空白，用户完整填写；`catalog_model_id` 保持 NULL。

---

#### Step 2 — 能力标签选择

**目标**：确认该模型支持哪些能力。

```
┌─────────────────────────────────────────────────────────────────┐
│  配置向导  2/4 — 能力标签                                          │
│                                                                   │
│  模型：即梦 Seedance v1（seedance3344）                           │
│                                                                   │
│  此模型能做什么？（可多选）                                        │
│                                                                   │
│  视频                                                             │
│  ☑ 视频生成 (video_generation)      ← AI 预选                    │
│  □ 视频编辑 (video_editing)                                       │
│                                                                   │
│  图片                                                             │
│  □ 图片生成 (image_generation)                                    │
│  □ 图片编辑 (image_editing)                                       │
│                                                                   │
│  语音                                                             │
│  □ 语音合成 (tts)                                                 │
│  □ 语音转写 (stt)                                                 │
│                                                                   │
│  对话                                                             │
│  □ 文本对话 (chat)                                                │
│                                                                   │
│                       [← 上一步]  [取消]  [下一步 →]              │
└─────────────────────────────────────────────────────────────────┘
```

---

#### Step 3 — 参数细化

**目标**：根据 Step 2 选择的能力，填写具体参数约束。每个能力对应一组参数卡片，LLM 推断值作为默认值预填。

**视频生成参数卡片示例**：

```
┌─────────────────────────────────────────────────────────────────┐
│  配置向导  3/4 — 参数细化                                          │
│                                                                   │
│  视频生成参数                                                      │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ 最大时长              [10] 秒                               │  │
│  │ 最大分辨率            [720p        ▼]  (360p/720p/1080p)  │  │
│  │ 支持的比例            ☑ 16:9  ☑ 9:16  ☑ 1:1  □ 4:3       │  │
│  │ 帧率                  [24] fps   （留空 = 不限制）          │  │
│  │ 是否需要异步          ☑ 是（视频生成通常需要任务轮询）       │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                   │
│  💡 参数来源：官方模型目录（即梦 Seedance v1）                     │
│     实际参数以供应商文档为准，可在此调整。                         │
│                                                                   │
│                       [← 上一步]  [取消]  [下一步 →]              │
└─────────────────────────────────────────────────────────────────┘
```

**LLM 参数卡片**（如选了 chat）：

```
│ 上下文窗口          [128000] tokens                              │
│ 最大输出 tokens     [4096]                                       │
│ 支持图片输入        ○ 是  ◉ 否                                    │
│ 支持工具调用        ○ 是  ◉ 否                                    │
│ 支持结构化输出      ○ 是  ◉ 否                                    │
│ 支持思维链          ○ 是  ◉ 否                                    │
```

---

#### Step 4 — 确认 & 生成变体

**目标**：最终确认，生成变体记录并写入数据库。

```
┌─────────────────────────────────────────────────────────────────┐
│  配置向导  4/4 — 确认生成                                          │
│                                                                   │
│  即将创建的变体：                                                  │
│                                                                   │
│  变体名称    [jimeng-seedance-video]  （可修改）                  │
│  描述        [即梦 Seedance v1 视频生成]  （可修改）               │
│  绑定模型    seedance3344 @ api.example.com                       │
│  适配器      jimeng-video                                         │
│  能力        video_generation                                      │
│                                                                   │
│  参数配置：                                                        │
│  • 最大时长：10 秒                                                 │
│  • 最大分辨率：720p                                                │
│  • 支持比例：16:9 / 9:16 / 1:1                                    │
│  • 需要异步：是                                                    │
│                                                                   │
│  同时更新模型记录：                                                │
│  • status: active                                                  │
│  • adapter_id: jimeng-video                                        │
│  • caps_overridden: 1（防止同步覆盖）                              │
│                                                                   │
│                       [← 上一步]  [取消]  [✓ 生成变体]            │
└─────────────────────────────────────────────────────────────────┘
```

---

### 后端接口

向导需要以下后端接口（归入 `/admin/wizard/` 路径）：

```
GET  /admin/wizard/models                  # 返回 status=unknown 或 adapter_id=unknown 的模型列表
POST /admin/wizard/infer                   # 触发 LLM 推断，返回 InferenceResult
GET  /admin/catalog/search?q=&limit=       # 全文搜索 model_catalog（供手动选择）
GET  /admin/catalog/:id                    # 返回目录单条详情（含 suggested_endpoint_caps）
POST /admin/wizard/complete                # 提交向导结果，写入 models + variants
```

`POST /admin/wizard/complete` 请求体：

```typescript
interface WizardCompleteRequest {
  model_id: string;
  catalog_model_id?: string;    // 选择的目录规范 ID（若匹配了目录条目）
  catalog_match_source?: string; // 匹配来源，如 "catalog_exact" | "manual" | "none"
  adapter_id: string;           // 确认使用的适配器
  endpoint_caps: string[];      // 能力标签列表
  param_caps: string[];
  modality: string;
  context_window?: number;
  max_output_tokens?: number;
  supports_stream?: boolean;
  requires_async?: boolean;
  max_duration_sec?: number;
  supported_sizes?: string[];
  video_aspect_ratios?: string[];
  video_max_resolution?: string;
  variant_name: string;
  variant_description?: string;
}
```

完成后后端执行两步写入（在一个事务内）：

```typescript
// 事务内执行
await db.transaction(async (tx) => {
  // 1. 更新 models 表（含目录关联字段）
  await tx.update(models).set({
    adapter_id: req.adapter_id,
    modality: req.modality,
    endpoint_caps: JSON.stringify(req.endpoint_caps),
    param_caps: JSON.stringify(req.param_caps),
    context_window: req.context_window,
    max_output_tokens: req.max_output_tokens,
    max_duration_sec: req.max_duration_sec,
    requires_async: req.requires_async ? 1 : 0,
    caps_overridden: 1,             // 人工确认，防止同步覆盖
    status: 'active',
    catalog_model_id: req.catalog_model_id ?? null,
    catalog_match_source: req.catalog_match_source ?? 'admin',
    catalog_match_confidence: 'high',
    catalog_synced_at: Date.now(),
  }).where(eq(models.id, req.model_id));

  // 2. 创建 variants 记录
  await tx.insert(variants).values({
    id: generateId(),
    name: req.variant_name,
    model_id: req.model_id,
    description: req.variant_description,
    param_overrides: JSON.stringify({
      ...(req.video_aspect_ratios && { aspect_ratio: req.video_aspect_ratios[0] }),
    }),
    created_at: Date.now(),
    updated_at: Date.now(),
  });
});
```

---

### 向导的局限性

| 限制 | 说明 |
|---|---|
| LLM 推断不保证准确 | 目录不可能穷举所有模型，推断仅供参考，用户必须确认 |
| 五层识别不等于已验证能力 | 目录命中只产生"建议"，生产调用前须管理员确认 |
| 无法自动发现接口格式 | 视频适配器的 endpoint URL、轮询逻辑仍需人工编写适配器代码 |
| 向导配置的参数是声明性的 | 实际参数限制以供应商为准，向导不能验证参数是否真实有效 |
| 依赖"向导 LLM 变体"配置 | 未配置时自动降级为纯目录候选 + 手动配置，不阻塞使用 |
| 目录数据有滞后 | models.dev 是社区维护，新发布模型可能未录入，需手动填写 |

---

## 19. 外部模型目录同步机制

本章描述 `model_catalog` 表与外部数据源（`models.dev`）之间的同步策略、ETL 逻辑和降级处理。

### 数据源分工

| 数据源 | 覆盖范围 | 写入方式 |
|---|---|---|
| `models.dev/models.json` | LLM 为主（500+ 模型），少量图片/音频 family | 在线同步或快照导入 |
| `openhub:builtin`（内置补充） | 视频、图片、音频等 models.dev 覆盖不足的模型 | 随代码发布，仅 INSERT OR IGNORE |

两类来源共用同一张 `model_catalog` 表，通过 `source_url` 字段区分，互不覆盖。

---

### 快照导入（启动时）

服务首次启动时，将内置快照以 `INSERT OR IGNORE` 写入 `model_catalog`，不覆盖已有行：

```typescript
async function importSnapshot(db: DB) {
  const snapshot = await import('./catalog-snapshot.json');
  // 分批写入，每批 200 条，避免大事务
  for (const batch of chunk(snapshot.data, 200)) {
    await db.insert(modelCatalog)
      .values(batch.map(toDbRow))
      .onConflictDoNothing();  // 已有行（在线同步写入的新版本）不覆盖
  }
}
```

快照文件路径：`packages/server/src/engine/capability/catalog-snapshot.json`

快照在 CI 中由维护者定期更新（对应 Phase 2 中的"目录 schema 版本检测 + 自动更新提示"任务）。

---

### 在线同步（后台定时）

在线同步为可选功能，失败不阻断任何业务。

**触发方式**：
- 服务启动后 30 秒延迟触发一次（避免抢启动资源）
- 之后每 24 小时执行一次
- 管理员手动触发：`POST /admin/catalog/sync`

**ETL 流程**：

```
1. 创建 catalog_sync_runs 记录（status=running）
2. HEAD 请求检测 etag，与上次 schema_version 对比
   → etag 未变化：写 status=success + record_count=0，跳过后续步骤
3. GET https://models.dev/models.json（带 If-None-Match）
4. JSON.parse → Zod 校验（使用与 models.dev schema.ts 对应的宽松 Zod schema）
   → 校验失败（字段缺失或类型错误）：写 status=failed，保留上一版本，退出
5. 计算新旧数据 diff（按 id 对比 key 字段 hash）
6. 临时表暂存（catalog_sync_staging），校验通过后事务切换
7. 执行 upsert（INSERT OR REPLACE）：
   - source_url = 'openhub:builtin' 的行跳过（不覆盖内置补充）
   - 已有 models 行关联该 catalog_id 且 caps_overridden=1 的，只更新元数据字段
     （name、description、family、release_date），不修改能力推断字段
8. 写 catalog_sync_runs（status=success）
9. 清理 catalog_sync_staging
```

**Zod 校验 schema（宽松版，允许未知字段）**：

models.dev 使用 `.strict()` 做写入校验；OpenHub 消费 JSON 时用非 strict 版本，对未知字段忽略，只严格校验依赖的字段：

```typescript
const CatalogItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  family: z.string().optional(),
  attachment: z.boolean().optional(),
  reasoning: z.boolean().optional(),
  tool_call: z.boolean().optional(),
  structured_output: z.boolean().optional(),
  temperature: z.boolean().optional(),
  knowledge: z.string().optional(),
  release_date: z.string().optional(),
  last_updated: z.string().optional(),
  open_weights: z.boolean().optional(),
  limit: z.object({
    context: z.number().optional(),
    input: z.number().optional(),
    output: z.number().optional(),
  }).optional(),
  modalities: z.object({
    input: z.array(z.string()),
    output: z.array(z.string()),
  }).optional(),
  reasoning_options: z.array(z.unknown()).optional(),
}).passthrough();  // 允许未知字段，不 strict

const CatalogResponseSchema = z.object({
  data: z.array(CatalogItemSchema),
});
```

---

### 降级策略

| 场景 | 处理方式 |
|---|---|
| 网络不可达（DNS / 连接超时） | 跳过本次同步，下次定时重试，告警日志 |
| HTTP 非 200 | 同上 |
| JSON 解析失败 | 写 status=failed，保留现有目录，不修改任何行 |
| Zod 校验失败（schema 漂移） | 写 status=failed，同上；管理界面显示"目录 schema 不兼容，请升级 OpenHub" |
| 同步中服务重启 | catalog_sync_staging 未提交事务自动回滚，下次重新同步 |
| models.dev 删除了某个模型 ID | OpenHub **不删除** `model_catalog` 行；只在同步报告中记录"远端已移除"的 ID |

---

### 能力映射更新

同步完成后，对满足以下条件的站点模型实例触发一次目录重新匹配：

- `caps_overridden = 0`（未被人工覆盖）
- `catalog_model_id IS NULL` 或 `catalog_synced_at < sync_started_at`（目录有更新）

重新匹配只更新 `catalog_model_id`、`catalog_match_source`、`catalog_match_confidence`、`catalog_synced_at` 四个字段，**不直接更新能力字段**。能力字段的更新只能通过以下方式：

1. 管理员在管理界面手动修改（设 `caps_overridden=1`）
2. 完成向导配置（设 `caps_overridden=1`）
3. 新站点同步时首次写入（`caps_overridden=0` 的新行）

---

### 管理界面

`/sites` 页面新增目录状态栏：

```
[目录同步状态]  最后同步：2026-08-16 03:00  |  版本：a3f8c21  |  条目：612
[手动同步]  [查看同步日志]
```

同步日志展示最近 10 次 `catalog_sync_runs` 记录（时间、状态、变更数、错误信息）。

---

## 20. 上游源码复用清单

本节记录 [models.dev](https://github.com/anomalyco/models.dev) 仓库（MIT License）中哪些代码可以直接复用、哪些只能参考设计思路。上游仓库采用 MIT License，复制代码后须保留原版权和许可声明。建议在项目中创建 `LICENSE.third-party.md` 或 `NOTICE` 文件集中记录所有第三方依赖的许可证信息。

### 可直接复用的代码

以下代码为纯数据定义或无业务逻辑的通用工具，可直接复制到项目中：

#### 1. `ModelFamilyValues` 枚举（约 200 个 family 字面量）

**上游位置**：`packages/core/src/family.ts`

**本项目用途**：第 5 章能力识别引擎的 family 枚举，替换目前手写的少量 family。

```typescript
// packages/server/src/engine/catalog/upstream/family.ts
/**
 * Adapted from anomalyco/models.dev
 * Original: https://github.com/anomalyco/models.dev/blob/dev/packages/core/src/family.ts
 * License: MIT
 */

export const ModelFamilyValues = [
  // OpenAI/GPT style
  "gpt", "gpt-codex", "gpt-codex-spark", "gpt-codex-mini",
  "gpt-pro", "gpt-mini", "gpt-nano", "gpt-sol", "gpt-terra",
  "gpt-luna", "gpt-oss", "gpt-image",

  // OpenAI o-series (reasoning models)
  "o", "o-mini", "o-pro",

  // Anthropic style
  "claude", "claude-haiku", "claude-sonnet", "claude-opus",
  "claude-fable", "claude-mythos",

  // Gemini style
  "gemini", "gemini-pro", "gemini-flash", "gemini-flash-lite",
  "gemini-embedding",

  // GLM (Zhipu)
  "glm", "glmv", "glm-air", "glm-flash", "glm-free", "glm-z",

  // Meta Llama
  "llama",

  // Meta Muse
  "muse",

  // Alibaba Qwen
  "qwen", "qwen3.5", "qwen3.6", "qwen3.7-plus", "qwen3.7-max",
  "qwen3.8-max", "qwen-free",

  // DeepSeek
  "deepseek", "deepseek-thinking", "deepseek-flash",
  "deepseek-flash-free", "deepseek-flash-think",

  // Microsoft Phi
  "phi",

  // Moonshot Kimi
  "kimi", "kimi-k2", "kimi-k3", "kimi-free", "kimi-thinking",

  // Mistral family
  "mistral", "mistral-large", "mistral-medium", "mistral-small",
  "mistral-nemo", "ministral", "codestral", "devstral",
  "pixtral", "mixtral",

  // xAI Grok
  "grok", "grok-build", "grok-vision", "grok-beta",

  // Google Gemma
  "gemma",

  // AWS Nova
  "nova", "nova-pro", "nova-lite", "nova-micro",

  // Cohere Command
  "command", "command-r", "command-a", "command-light",
  "north", "north-free",

  // NVIDIA Nemotron
  "nemotron", "nemotron-free",

  // MiniMax
  "minimax", "minimax-m2.5", "minimax-m2.7", "minimax-m3",
  "minimax-m3-free", "minimax-free",

  // Hunyuan
  "hunyuan",

  // Yi
  "yi",

  // Granite
  "granite",

  // Sonar (Perplexity)
  "sonar", "sonar-pro", "sonar-reasoning", "sonar-deep-research",

  // Image generation
  "dall-e", "flux", "imagen", "recraft",
  "stable-diffusion", "ideogram", "dreamshaper",

  // Video generation
  "sora", "veo", "runway", "dream-machine",

  // Audio/Speech
  "whisper", "elevenlabs", "lyria", "melotts",

  // Embedding models
  "text-embedding", "cohere-embed", "voyage",
  "mistral-embed", "bge", "plamo", "codestral-embed",

  // ... 其余 family 参照上游完整列表
] as const;

export const ModelFamily = z.enum(ModelFamilyValues);
export type ModelFamily = z.infer<typeof ModelFamily>;
```

**使用建议**：将上游 `family.ts` 完整列表直接复制进来，不要维护子集。DESIGN.md 第 5 章的 `FAMILY_DEFAULTS` 字典的 key 应全部来自本枚举。

#### 2. `inferKimiFamily` 函数（模型名正则归一化）

**上游位置**：`packages/core/src/family.ts` 末尾

```typescript
// packages/server/src/engine/catalog/upstream/family.ts
/**
 * Adapted from anomalyco/models.dev
 * License: MIT
 */

export function inferKimiFamily(...values: string[]): ModelFamily | undefined {
  const target = values.join(" ").toLowerCase();
  if (/kimi[^a-z0-9]*k2(?:[^a-z0-9]*\d+)?[^a-z0-9]*thinking/.test(target))
    return "kimi-thinking";
  if (/kimi[\s_-]*k2/.test(target)) return "kimi-k2";
  if (/kimi[\s_-]*k3/.test(target)) return "kimi-k3";
  return undefined;
}
```

**本项目用途**：第 5 章第四层关键词匹配中，对"厂商拼写变体"进行归一化。可参考此模式扩展其他模型的类似函数。

#### 3. `applyOmit` 函数（按点路径深度删除字段）

**上游位置**：`packages/core/src/generate.ts`

```typescript
// packages/server/src/engine/catalog/upstream/omit.ts
/**
 * Adapted from anomalyco/models.dev
 * Original: https://github.com/anomalyco/models.dev/blob/dev/packages/core/src/generate.ts
 * License: MIT
 */

function applyOmit(target: Record<string, unknown>, paths: string[]): void {
  omitLoop: for (const omit of paths) {
    const parts = omit.split(".");
    const parents: Array<{ value: Record<string, unknown>; key: string }> = [];
    let current = target;

    for (const part of parts.slice(0, -1)) {
      const next = current[part];
      if (next === undefined || next === null ||
          typeof next !== "object" || Array.isArray(next)) {
        continue omitLoop;
      }
      parents.push({ value: current, key: part });
      current = next as Record<string, unknown>;
    }

    const lastPart = parts.at(-1);
    if (lastPart === undefined || !(lastPart in current)) continue;
    delete current[lastPart];

    // 清理变为空的父对象
    for (let index = parents.length - 1; index >= 0; index--) {
      const parent = parents[index];
      if (parent === undefined) continue;
      const value = parent.value[parent.key];
      if (value === null || value === undefined ||
          typeof value !== "object" || Array.isArray(value) ||
          Object.keys(value as object).length > 0) break;
      delete parent.value[parent.key];
    }
  }
}
```

**本项目用途**：第 7 章"站点实例覆盖目录字段"时，按 `base_model_omit` 路径删除不需要继承的字段。

#### 4. `stable` 函数（对象稳定序列化，用于语义对比）

**上游位置**：`packages/core/src/sync/index.ts`

```typescript
// packages/server/src/engine/catalog/upstream/stable.ts
/**
 * Adapted from anomalyco/models.dev
 * Original: https://github.com/anomalyco/models.dev/blob/dev/packages/core/src/sync/index.ts
 * License: MIT
 */

export function stable(value: unknown): string {
  if (Array.isArray(value)) {
    const items = value.map(stable);
    const ordered = value.every(
      (item) => item === null || typeof item !== "object",
    )
      ? items.sort()
      : items;
    return `[${ordered.join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
```

**本项目用途**：第 19 章 ETL 流程第 5 步——计算新旧目录记录的 hash，通过 `stable(old) !== stable(new)` 判断是否需要更新。

#### 5. Zod schema 字段定义子集

**上游位置**：`packages/core/src/schema.ts`

以下字段定义可直接复制到本项目的 schema 文件中：

```typescript
// packages/server/src/engine/catalog/upstream/schema.ts
/**
 * Adapted from anomalyco/models.dev
 * Original: https://github.com/anomalyco/models.dev/blob/dev/packages/core/src/schema.ts
 * License: MIT
 */

import { z } from "zod";

// Modalities
const Modality = z.enum([
  "text", "audio", "image", "video", "pdf",
]);
export const ModalitiesSchema = z.object({
  input: z.array(Modality),
  output: z.array(Modality),
});

// Limit
export const LimitSchema = z.object({
  context: z.number().int().min(0).optional(),
  input: z.number().int().min(0).optional(),
  output: z.number().int().min(0).optional(),
});

// ReasoningOptions (discriminated union)
export const ReasoningOptionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("toggle") }),
  z.object({
    type: z.literal("effort"),
    values: z.array(
      z.enum([
        "none", "minimal", "low", "medium",
        "high", "xhigh", "max", "default",
      ]).or(z.null()),
    ),
  }),
  z.object({
    type: z.literal("budget_tokens"),
    min: z.number().int().min(0).optional(),
    max: z.number().int().min(0).optional(),
  }).refine((v) => v.min === undefined || v.max === undefined || v.min <= v.max, {
    message: "min must be <= max",
  }),
]);

// DateString
export const DateStringSchema = z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/);

// Link / Weights / BenchmarkResult（仅结构定义，OpenHub 不使用其业务逻辑）
export const ModelLinkSchema = z.object({
  name: z.string().optional(),
  url: z.string().url(),
  suggested: z.boolean().optional(),
});
export const ModelWeightsSchema = z.object({
  label: z.string().optional(),
  url: z.string().url(),
  format: z.string().optional(),
  quantization: z.string().optional(),
});
export const BenchmarkResultSchema = z.object({
  benchmark: z.string(),
  score: z.union([z.number(), z.string()]),
  rank: z.number().optional(),
  url: z.string().url().optional(),
});

// 完整的 models.dev 目录校验 schema（宽松版，不 strict）
export const CatalogItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  family: z.string().optional(),
  attachment: z.boolean().optional(),
  reasoning: z.boolean().optional(),
  tool_call: z.boolean().optional(),
  structured_output: z.boolean().optional(),
  temperature: z.boolean().optional(),
  knowledge: z.string().optional(),
  release_date: DateStringSchema.optional(),
  last_updated: DateStringSchema.optional(),
  open_weights: z.boolean().optional(),
  limit: LimitSchema.optional(),
  modalities: ModalitiesSchema.optional(),
  reasoning_options: z.array(ReasoningOptionSchema).optional(),
}).passthrough(); // 允许未知字段，不 strict

export const CatalogResponseSchema = z.object({
  data: z.array(CatalogItemSchema),
});
```

**本项目用途**：第 7 章 `model_catalog` 表字段校验（部分字段）；第 19 章 ETL 流程 JSON 解析。

**不使用**：不要复制 `Cost`、`CostTier`、`Provider`、`experimental.modes`、`provider.npm/api/shape` 等字段。本项目的 `raw_payload` 字段用于保存上游完整 JSON，schema 必须 `.passthrough()`，否则目录 schema 漂移时校验会失败。

---

### 可参考设计思路，但需自行实现的代码

以下代码的思路可借鉴，但业务语义不同，必须重新实现：

#### 6. 目录→站点实例的字段映射（`catalogToModelRow`）

**参考来源**：`packages/core/src/generate.ts` 的 `inheritableModelMetadata`

**本项目实现方式**：

```typescript
// packages/server/src/engine/catalog/catalog-to-model.ts
// 自研，不直接复用上游 generate.ts 的继承语义

import { CatalogItemSchema } from "./upstream/schema.ts";

export function catalogToModelRow(
  catalog: z.infer<typeof CatalogItemSchema>,
): Partial<ModelRow> {
  return {
    catalog_model_id: catalog.id,
    name: catalog.name,
    family: catalog.family,
    modalities_in: catalog.modalities?.input
      ? JSON.stringify(catalog.modalities.input)
      : null,
    modalities_out: catalog.modalities?.output
      ? JSON.stringify(catalog.modalities.output)
      : null,
    context_limit: catalog.limit?.context,
    output_limit: catalog.limit?.output,
    input_limit: catalog.limit?.input,
    reasoning: catalog.reasoning,
    tool_call: catalog.tool_call,
    structured_output: catalog.structured_output,
    open_weights: catalog.open_weights,
    raw_payload: JSON.stringify(catalog), // 完整保存，不丢失未消费字段
  };
}
```

**原因**：上游的 `inheritableModelMetadata` 排除 `benchmarks`、`license`、`links`、`weights` 是为了 base_model 继承；本项目应把完整上游 JSON 存入 `raw_payload`，需要展示的字段再单独提取。

#### 7. 人工覆盖保留策略（`respectCapsOverridden`）

**参考来源**：`packages/core/src/sync/index.ts` 的 `preserveBaseModel`、`preserveDescription`、`preserveReasoningOptions`

**本项目实现方式**：

```typescript
// packages/server/src/engine/catalog/preserve.ts
// 自研，参考上游 preserve* 函数的"不覆盖人工字段"策略

export function respectCapsOverridden(
  existing: ExistingModelRow,
  catalog: Partial<ModelRow>,
): Partial<ModelRow> {
  const result: Partial<ModelRow> = {
    catalog_model_id: catalog.catalog_model_id,
    catalog_match_source: catalog.catalog_match_source ?? "catalog_sync",
    catalog_synced_at: Date.now(),
  };

  // caps_overridden=1 时，同步只更新目录关联字段
  if (existing.caps_overridden === 1) {
    // 不更新 endpoint_caps / param_caps / adapter_id / limit 等能力字段
    return result;
  }

  // caps_overridden=0 时，更新全部目录建议字段
  return {
    ...result,
    endpoint_caps: catalog.endpoint_caps,
    param_caps: catalog.param_caps,
    adapter_id: catalog.adapter_id,
    context_limit: catalog.context_limit,
    input_limit: catalog.input_limit,
    output_limit: catalog.output_limit,
  };
}
```

**原因**：上游三个 `preserve*` 函数保护的是各自独立的字段；本项目应统一用 `caps_overridden` 字段级保护，而不是总开关。

#### 8. `stable` 的包装用法（catalog diff）

**参考来源**：`packages/core/src/sync/index.ts` 的 `sameModel` 函数

**本项目实现方式**：

```typescript
// packages/server/src/engine/catalog/diff.ts
// 自研，用 stable 做目录级别 diff

import { stable } from "./upstream/stable.ts";

export function computeCatalogDiff(
  oldRecords: Map<string, CatalogRecord>,
  newRecords: Map<string, CatalogRecord>,
): CatalogDiffResult {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  for (const [id, newRecord] of newRecords) {
    const oldRecord = oldRecords.get(id);
    if (!oldRecord) {
      added.push(id);
    } else if (stable(oldRecord) !== stable(newRecord)) {
      changed.push(id);
    }
  }

  for (const [id] of oldRecords) {
    if (!newRecords.has(id)) removed.push(id);
  }

  return { added, removed, changed };
}
```

---

### 绝对不能复用的代码

以下代码与本项目架构无关，或涉及不同的业务逻辑，严禁复制：

| 禁止复用的上游代码 | 原因 |
|---|---|
| `formatToml`、`formatMetadataToml`、`formatInteger`、`formatKey`、`quote` | 本项目用 SQLite + JSON，不需要 TOML 序列化 |
| `Bun.Glob("**/*.toml")`、TOML import、`tomlFiles` | 同上，本项目消费 JSON API |
| `packages/core/src/sync/providers/` 下 30+ 个 provider sync 模块 | 本项目直接消费 `models.dev/models.json`，不需要拉各 provider API |
| `SyncProvider`、`SyncResult`、`SyncOptions` 接口 | 本项目只需要一个 `syncCatalogFromUrl()` 函数 |
| `main` CLI 入口、`writeReport` markdown 报告 | CLI 逻辑不适用于本项目的数据库 ETL |
| `Cost`、`CostTier`、`OutputCost`、`AuthoredCost` schema | 本项目设计明确不含 provider 定价 |
| `Provider` schema（`npm`/`api`/`shape`/`body`/`headers`） | 本项目不用 models.dev 的 npm package 信息 |
| `experimental.modes` schema | 本项目的 experimental 语义与上游不同 |

---

### 推荐的代码目录结构

```
packages/server/src/engine/catalog/
  upstream/               # 从 models.dev 复制的代码（MIT License）
    family.ts             # ModelFamilyValues + inferKimiFamily
    schema.ts             # Zod 字段定义子集（Modalities/Limit/ReasoningOption/DateString）
    stable.ts             # stable 函数
    omit.ts               # applyOmit 函数（若需要）

  catalog-to-model.ts     # 自研：目录记录 → 站点模型行
  diff.ts                 # 自研：目录 diff（使用 stable）
  preserve.ts             # 自研：caps_overridden 保护
  sync.ts                 # 自研：models.dev JSON → 数据库同步事务
  matcher.ts              # 自研：四步目录匹配算法
  capability-map.ts       # 自研：目录字段 → endpoint_caps 映射

LICENSE.third-party.md    # 集中记录第三方许可证（包含 models.dev MIT License）
```

> 文档版本：v1.1
> 最后更新：2026-08-16
