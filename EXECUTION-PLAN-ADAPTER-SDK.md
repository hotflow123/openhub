# OpenHub 通用供应商适配器 SDK 实施计划

> **状态：已被多模态主计划取代。** 本文件只保留此前的视频优先版本，后续不得单独执行；请以 `EXECUTION-PLAN-MULTIMODAL-ADAPTER-SDK.md` 为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or execute this plan task-by-task with a review checkpoint after each task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 OpenHub 建设为一个以视频为第一优先级的统一模型接入平台：上层软件只调用稳定的 OpenHub API，供应商通过受审查的适配器包或已验证的协议模板接入，模型参数由来源明确的 Schema 驱动。

**Architecture:** 保留现有的站点、模型、变体、任务 worker 和适配器体系，在其上增加稳定的适配器 manifest、视频适配器 SDK、能力契约和合规测试层。公共层只统一任务生命周期、错误和结果；供应商路径、字段、状态和媒体处理由适配器负责。常见协议可以使用代码内置的声明式模板，特殊协议必须使用 SDK 编写适配器，不允许通过数据库配置任意 HTTP 请求。

**Tech Stack:** TypeScript、Hono、Drizzle SQLite、原生 `fetch`、Zod、Node `node:test`、Vite、pnpm workspace、Node 22 LTS。

## Global Constraints

- 不承诺所有供应商零代码接入；目标是所有已验证适配器都使用同一个 OpenHub 视频 API。
- 不创建任意 HTTP 方法、任意 URL、任意响应路径可由用户填写的通用执行器。
- 供应商地址和 API Key 可以由管理员配置；请求路径、鉴权策略、状态解析和结果解析必须来自代码内受审查的适配器或受信任模板。
- 模型名称只能用于身份和模态分类建议，不能单独生成可执行参数合同。
- 模型目录只提供身份、厂商、模型族和参数建议；供应商 Schema、适配器 manifest 或人工确认才是执行依据。
- 未确认的参数不得静默丢弃；必须保留在明确的 `provider_options` 中，或在上游调用前返回结构化错误。
- 视频适配器必须同时具备提交和查询能力；只有 `video.submit` 没有 `video.query` 的适配器不能创建可调用视频变体。
- 上游回调属于适配器内部机制；OpenHub 的 `callback_url` 只代表 OpenHub 对调用方的完成通知。
- API Key 必须加密存储、仅在内存中解密使用，不进入日志、错误响应、任务结果或测试快照。
- 默认只使用固定 fixture 和本地 mock；没有明确的非生产凭据时，不调用真实计费生成接口。
- P0 不新增 Redis、外部队列、插件市场、远程代码下载、多租户计费或对象存储代理。
- P0 先完成视频链路；在视频适配器边界稳定前，不扩展新的通用多模态执行抽象。
- 当前项目使用 Node 22 LTS 验证；Node 24 不能作为当前 `better-sqlite3` 的默认运行时。
- 不自动提交、推送或创建 PR；每个阶段只留下可审阅的工作树变更和可复现验证结果。

---

## 0. 独立分析与证据结论

### 0.1 已确认事实

| ID | 事实 | 本地证据 |
|---|---|---|
| F1 | OpenHub 已有统一适配器注册表，当前 `Adapter` 同时承载 LLM、图片、音频和视频能力。 | `packages/server/src/engine/adapter.ts` |
| F2 | OpenHub 已有视频提交、任务查询、任务列表和异步 worker。 | `packages/server/src/routes/v1/video.ts`、`packages/server/src/engine/tasks/worker.ts`、`packages/server/src/db/schema/tasks.ts` |
| F3 | 当前视频公共请求已经支持 `prompt`、`content[]`、时长、比例、分辨率、回调、幂等键和 `provider_options`。 | `packages/server/src/engine/adapter.ts`、`packages/server/src/routes/v1/video.ts` |
| F4 | 当前视频适配器是服务端内置 TypeScript 代码，已存在 OpenAI、Kling、Wan、Seedance 和 Grok 适配器。 | `packages/server/src/engine/adapters/`、`packages/server/src/engine/index.ts` |
| F5 | 现有适配器的提交路径、查询路径、请求体、状态字段和结果 URL 位置不同。 | `packages/server/src/engine/adapters/openai.ts`、`kling.ts`、`wan.ts`、`seedance.ts`、`grok.ts` |
| F6 | `models` 已保存 `adapterId`、模态、能力、Schema 证据、视频契约快照和目录关联；`variants` 已保存参数映射、限制和 `adapterConfig`。 | `packages/server/src/db/schema/models.ts`、`packages/server/src/db/schema/variants.ts` |
| F7 | 目录匹配和模型名称推理已经被设计为建议来源，不应直接替代供应商执行合同。 | `packages/server/src/engine/catalog/`、`packages/server/src/engine/discover.ts` |
| F8 | MemeFast 当前适配器支持模型发现、聊天、Embedding、图片和音频，没有视频提交与查询能力。 | `packages/server/src/engine/adapters/memefast.ts` |
| F9 | 当前分支的服务端测试 `44/44` 通过，服务端类型检查和前端构建通过；Node 24 运行 `better-sqlite3` 会发生 ABI 不匹配，Node 22 可正常加载。 | 本地测试结果、`packages/server/package.json`、原生模块加载结果 |

### 0.2 已观察到的协议差异

以下只证明适配器边界确实存在，不把差异直接假设成新的公共字段：

| 协议形态 | 需要适配的差异 |
|---|---|
| OpenAI 风格异步视频 | 提交和查询路径、任务 ID、状态和结果结构需要分别确认。 |
| Kling 直连模式 | 与 New API 封装模式不同，鉴权、提交路径、查询路径和任务结果字段不同。 |
| Wan/DashScope 直连模式 | 请求可能使用表单或供应商专有 JSON，任务状态和结果位于嵌套对象。 |
| Seedance/Volcano 内容数组模式 | 多模态 `content[]`、异步任务和状态字段由供应商定义。 |
| Grok 直连模式 | 任务 ID、状态和视频结果字段使用另一套结构。 |
| MemeFast 当前模式 | 能力发现和 OpenAI 兼容能力存在，但当前代码不能证明公开视频提交、查询和回调协议。 |

### 0.3 合理推测

1. 上层软件可以通过一个稳定的视频创建和查询 API 接入 OpenHub，而不需要知道供应商的路径和状态字段。
2. 协议重复度较高的供应商可以共享受信任的适配器模板；有特殊鉴权、媒体上传、存储或回调语义的供应商必须使用专用适配器。
3. 供应商适配器 SDK 的主要价值是固定边界、统一测试和统一任务结果，而不是让任意用户 JSON 自动变成可运行代码。

### 0.4 未验证假设

1. 未验证哪些供应商可以完全落入同一个声明式 JSON 任务模板；必须用至少三个真实文档或 fixture 评估，而不是预设覆盖率。
2. 未验证未来调用方是否需要独立 npm client；先稳定 HTTP API 和文档，再根据重复调用模式决定是否发布薄客户端。
3. 未验证任意供应商都提供可靠的模型发现或参数 Schema；没有 Schema 时只能进入人工确认或供应商扩展参数流程。
4. 未验证 MemeFast 是否会提供视频 API；在获得官方协议或固定 fixture 前，不实现 MemeFast 视频适配器。

### 0.5 结论

“所有供应商完全零代码即插即用”不是可验证的工程目标；可实现且有长期维护价值的目标是：

1. 所有已接入供应商都遵守同一套 OpenHub 视频任务 API。
2. 常见协议通过受信任模板配置完成接入。
3. 特殊协议通过 `@openhub/adapter-sdk` 实现独立适配器，不修改上层应用。
4. 每个模型都显示能力、参数和证据状态；未确认能力不会被标记为可执行。

---

## 1. 产品定位与验收口径

### 1.1 P0 交付物

- 稳定的 `POST /v1/video/generations`、`GET /v1/video/tasks/:id` 和任务列表接口。
- 统一的视频提交请求、任务状态、错误对象和结果对象。
- 可版本化的适配器 manifest，包含能力、配置 Schema、版本和证据引用。
- 受信任的常见 JSON 异步任务模板。
- 可由外部开发者实现的最小视频适配器 SDK。
- 适配器合规测试工具：能力检查、提交/查询生命周期、状态映射、结果映射和敏感信息检查。
- 管理后台可以显示适配器、适配器版本、模型模态、契约来源、Schema 状态和不可执行原因。
- 新供应商不会要求上层视频软件增加供应商分支代码。

### 1.2 P1 交付物

- `@openhub/client` 薄客户端，只封装 OpenHub API，不复制任何供应商逻辑。
- 供应商适配器模板脚手架和 fixture 生成命令。
- CI 中固定 Node 22、服务端测试、类型检查、前端构建和适配器合规测试。
- 适配器证据文档和供应商接入清单。

### 1.3 明确非目标

- 不做远程安装或远程执行第三方适配器代码。
- 不允许管理员在网页中填写任意请求路径、HTTP 方法、响应 JSONPath 后立即获得执行能力。
- 不用模型名称、Fal 目录或 models.dev 记录伪造供应商参数。
- 不把一个供应商的参数强行改名成所有供应商都必须支持的公共字段。
- 不在本计划内实现所有供应商；每个供应商仍需协议证据和合规 fixture。
- 不在本计划内把 MemeFast 变成视频供应商，除非获得其真实视频协议。

### 1.4 终态验收场景

```text
外部视频软件
  -> OpenHub 统一视频 API
  -> 路由到 model / variant
  -> 校验已确认契约和参数限制
  -> 适配器转换请求
  -> 供应商创建任务
  -> worker 查询供应商任务
  -> 适配器转换状态和结果
  -> OpenHub 返回统一任务
  -> 外部视频软件展示进度和视频
```

必须同时证明：

- 同一个公共请求可以经过至少三种不同协议 fixture。
- 供应商私有参数不会被静默删除或伪装成公共参数。
- 任务创建、轮询、成功、失败、取消或超时能映射到 OpenHub 状态。
- 结果 URL 不在固定位置时可以由专用适配器提取。
- 无 `video.query` 的适配器不能创建可调用视频变体。
- 未确认 Schema 的模型在调用前失败，并明确显示复核原因。
- 日志、任务查询和错误响应不泄露 API Key、原始 prompt 或媒体 URL。

---

## 2. 文件地图

### 新增

- Create: `.node-version` — 固定本地和 CI 的 Node 22 主版本。
- Create: `packages/adapter-sdk/package.json` — 发布无服务端运行时依赖的适配器 SDK 包。
- Create: `packages/adapter-sdk/src/types.ts` — 视频适配器、manifest、上下文、状态和结果类型。
- Create: `packages/adapter-sdk/src/conformance.ts` — 适配器定义检查和 fixture 合规测试工具。
- Create: `packages/adapter-sdk/src/index.ts` — SDK 公共导出入口。
- Create: `packages/server/src/engine/adapter-manifest.ts` — manifest Schema、版本和证据校验。
- Create: `packages/server/src/engine/adapters/templates/rest-json-task.ts` — 仅供代码内注册的常见 JSON 异步任务模板。
- Create: `packages/server/src/routes/admin/adapters.ts` — 管理端适配器列表和配置 Schema 查询接口。
- Create: `packages/server/test-adapter-manifest.ts` — manifest 和能力约束测试。
- Create: `packages/server/test-adapter-registry.ts` — 注册、版本、能力和配置校验测试。
- Create: `packages/server/test-adapter-conformance.ts` — 多协议 fixture 合规测试。
- Create: `packages/server/test-adapter-security.ts` — SSRF、超时、重试、日志和敏感字段测试。
- Create: `packages/server/test-fixtures/adapters/` — 每个协议族的请求、提交响应、查询响应和错误 fixture。
- Create: `packages/web/src/components/AdapterConfigForm.tsx` — 根据 manifest Schema 渲染受限配置表单。
- Create: `packages/client/package.json` — 可选的 OpenHub 视频调用薄客户端。
- Create: `packages/client/src/index.ts` — `OpenHubClient` 和视频任务方法。
- Create: `packages/client/test/client.test.ts` — 薄客户端请求和错误处理测试。
- Create: `docs/ADAPTER-SDK.md` — 适配器开发者文档。
- Create: `docs/VIDEO-INTEGRATION.md` — 外部网站或软件接入 OpenHub 的文档。
- Create: `docs/VIDEO-PROVIDER-EVIDENCE.md` — 供应商协议、证据、fixture、验证日期和支持状态。

### 修改

- Modify: `package.json` — workspace 脚本、Node engines 和统一验证命令。
- Modify: `packages/server/package.json` — 依赖 SDK、测试和类型检查脚本。
- Modify: `packages/server/src/engine/adapter.ts` — 兼容现有 Adapter，并接入 SDK 的视频接口和 manifest。
- Modify: `packages/server/src/engine/index.ts` — 注册内置适配器和 manifest。
- Modify: `packages/server/src/engine/discover.ts` — 分离运行时事实、目录建议和适配器证据。
- Modify: `packages/server/src/engine/tasks/worker.ts` — 统一结果转换、超时、可重试错误和敏感字段清理。
- Modify: `packages/server/src/lib/model-contract.ts` — 按证据优先级校验视频契约和扩展参数。
- Modify: `packages/server/src/engine/param-mapper.ts` — 禁止未知字段静默丢弃，保留显式 `provider_options`。
- Modify: `packages/server/src/routes/v1/video.ts` — 输出统一错误、任务状态和能力不足原因。
- Modify: `packages/server/src/routes/admin.ts` — 挂载适配器 manifest 查询路由。
- Modify: `packages/server/src/routes/admin/sites.ts` — 创建和更新站点时校验适配器 manifest 与配置。
- Modify: `packages/server/src/routes/admin/variants.ts` — 创建视频变体时同时校验提交、查询和契约状态。
- Modify: `packages/server/src/db/schema/models.ts` — 保存适配器版本和契约验证状态，保留现有字段兼容性。
- Modify: `packages/server/src/db/schema/variants.ts` — 为适配器配置保存验证状态或兼容迁移策略。
- Generate: `packages/server/drizzle/` — 生成适配器版本和配置验证字段的迁移。
- Modify: `packages/web/src/lib/api.ts` — 适配器 manifest、配置验证和契约状态 API。
- Modify: `packages/web/src/pages/Sites.tsx` — 选择适配器、展示版本和验证状态。
- Modify: `packages/web/src/pages/Variants.tsx` — 展示公共参数、供应商参数和证据状态。
- Modify: `packages/web/src/pages/Wizard.tsx` — 将接入流程按“适配器—连接—发现—确认—变体”组织。
- Modify: `packages/web/src/pages/Models.tsx` — 显示可执行、待确认和不支持原因。
- Modify: `README.md` — 更新产品定位、集成方式和支持边界。

---

## 3. 任务分解

### Task 1: 固定运行时与可复现验证基线

**Files:**
- Create: `.node-version`
- Modify: `package.json`
- Modify: `packages/server/package.json`
- Modify: `README.md`

**Interfaces:**
- Produces: 统一的 Node 22 验证入口；不改变业务 API。

- [ ] **Step 1: 固定 Node 版本声明**

  `.node-version` 内容固定为 `22`，根 `package.json` 增加：

  ```json
  "engines": {
    "node": ">=22 <23",
    "pnpm": ">=9 <11"
  }
  ```

- [ ] **Step 2: 统一验证命令**

  保留现有脚本，先使用当前已存在的命令建立基线：

  ```text
  pnpm typecheck
  pnpm test
  pnpm --filter @openhub/web build
  ```

- [ ] **Step 3: 验证基线**

  在 Node 22 下运行服务端测试、类型检查和前端构建；Node 24 只记录为不受支持环境，不修改业务代码绕过 ABI 错误。

  Expected: 现有测试全部通过，后续任务可以使用同一运行时复现结果。

### Task 2: 建立视频适配器 SDK 公共边界

**Files:**
- Create: `packages/adapter-sdk/package.json`
- Create: `packages/adapter-sdk/src/types.ts`
- Create: `packages/adapter-sdk/src/index.ts`
- Modify: `pnpm-workspace.yaml`
- Modify: `packages/server/package.json`
- Modify: `packages/server/src/engine/adapter.ts`
- Create: `packages/server/test-adapter-sdk.ts`

**Interfaces:**
- Produces: `@openhub/adapter-sdk` 的 `VideoProviderAdapter`、`AdapterManifest`、`VideoAdapterContext`、`VideoSubmitResult`、`VideoQueryResult`。

  ```ts
  export type VideoTaskStatus = "pending" | "processing" | "completed" | "failed" | "timeout";

  export interface VideoSubmitRequest {
    model?: string;
    prompt?: string;
    content?: Array<{ type: "text" | "image" | "video" | "audio"; text?: string; url?: string; role?: string }>;
    duration?: number | string;
    aspect_ratio?: string;
    resolution?: string;
    callback_url?: string;
    idempotency_key?: string;
    provider_options?: Record<string, unknown>;
  }

  export interface VideoAdapterContext {
    targetUrl: string;
    apiKey: string;
    config?: Record<string, unknown>;
  }

  export interface VideoResult {
    video_url: string;
    cover_url?: string;
    duration?: number;
    width?: number;
    height?: number;
    ratio?: string;
    resolution?: string;
    usage?: Record<string, number>;
    provider_metadata?: Record<string, unknown>;
  }

  export interface VideoSubmitResult {
    siteTaskId: string;
    initialStatus: VideoTaskStatus;
    rawResult?: unknown;
  }

  export interface VideoQueryResult {
    status: VideoTaskStatus;
    result?: VideoResult;
    error?: string;
    raw?: unknown;
  }

  export type ConfigSchema = {
    type: "object";
    properties: Record<string, {
      type: "string" | "integer" | "number" | "boolean" | "enum";
      required?: boolean;
      enum?: string[];
      default?: unknown;
      secret?: boolean;
    }>;
  };

  export interface EvidenceRef {
    kind: "official-doc" | "fixture" | "runtime" | "admin-confirmed";
    ref: string;
    verifiedAt: string;
  }

  export interface AdapterManifest {
    id: string;
    version: string;
    displayName: string;
    modalities: Array<"video">;
    capabilities: Array<"video.submit" | "video.query" | "video.cancel" | "video.callback">;
    configSchema: ConfigSchema;
    evidence: EvidenceRef[];
  }

  export interface VideoProviderAdapter {
    manifest: AdapterManifest;
    validateConfig?(config: Record<string, unknown> | undefined): string | null;
    submitVideoTask(request: VideoSubmitRequest, context: VideoAdapterContext): Promise<VideoSubmitResult>;
    queryVideoTask(siteTaskId: string, context: VideoAdapterContext): Promise<VideoQueryResult>;
  }
  ```

- Consumes: 当前 `VideoSubmitRequest`、`VideoTaskStatus` 和 `VideoResult` 的语义。

- [ ] **Step 1: 定义 SDK 无框架类型**

  SDK 不依赖 Hono、Drizzle、SQLite 或 Web UI；只包含视频请求、上下文、状态、结果、manifest、Schema 和证据类型。

- [ ] **Step 2: 保留服务端兼容层**

  让当前 `Adapter` 继续支持聊天、图片和音频方法；视频方法实现 SDK 接口，不一次性迁移所有旧适配器。

- [ ] **Step 3: 编写边界测试**

  测试必须拒绝：缺少 `video.submit`、缺少 `video.query`、manifest 能力与方法不一致、空 ID、非法版本字符串和未知状态。

  `packages/*` 已由现有 `pnpm-workspace.yaml` 自动纳入，新包不修改 workspace glob。

- [ ] **Step 4: 运行测试**

  ```text
  pnpm --filter @openhub/server exec tsx --test test-adapter-sdk.ts
  ```

  Expected: 新增测试通过，现有视频测试不受影响。

### Task 3: 改造注册表和适配器 manifest

**Files:**
- Create: `packages/server/src/engine/adapter-manifest.ts`
- Modify: `packages/server/src/engine/adapter.ts`
- Modify: `packages/server/src/engine/index.ts`
- Create: `packages/server/src/routes/admin/adapters.ts`
- Modify: `packages/server/src/routes/admin.ts`
- Create: `packages/server/test-adapter-manifest.ts`
- Create: `packages/server/test-adapter-registry.ts`

**Interfaces:**
- Produces: `listAdapterManifests()`、`getAdapterManifest(id)`、`validateAdapterDefinition(adapter)`、`validateAdapterConfig(adapter, config, modality)`。
- Consumes: `@openhub/adapter-sdk` 的 manifest 和视频适配器类型。

- [ ] **Step 1: 实现 manifest Zod 校验**

  校验 `id`、SemVer 版本、显示名称、能力枚举、配置 Schema 和证据引用；manifest 不能声明未实现的能力。

- [ ] **Step 2: 在注册时执行能力不变量**

  `registerAdapter()` 在启动时拒绝以下定义：

  ```text
  capabilities 包含 video.submit 但没有 submitVideoTask
  capabilities 包含 video.query 但没有 queryVideoTask
  video 适配器缺少 video.submit 或 video.query
  重复的 canonical adapter id
  ```

- [ ] **Step 3: 增加只读管理接口**

  `GET /admin/adapters` 只返回 manifest、能力、版本、配置字段和证据摘要，不返回 API Key 或运行时上下文。

- [ ] **Step 4: 测试注册与查询**

  Expected: 内置适配器均能列出；非法适配器在启动时失败；管理接口不包含密钥字段。

### Task 4: 增加受信任的常见 JSON 异步任务模板

**Files:**
- Create: `packages/server/src/engine/adapters/templates/rest-json-task.ts`
- Modify: `packages/server/src/engine/adapters/openai.ts`
- Modify: `packages/server/src/engine/adapters/kling.ts`
- Modify: `packages/server/src/engine/adapters/wan.ts`
- Modify: `packages/server/src/engine/adapters/seedance.ts`
- Modify: `packages/server/src/engine/adapters/grok.ts`
- Create: `packages/server/test-adapter-template.ts`
- Create: `packages/server/test-fixtures/adapters/`

**Interfaces:**
- Produces: 只接受代码内注册的 `JsonTaskAdapterDefinition`，不读取数据库中的 HTTP 方法、路径或响应选择器。

  ```ts
  interface JsonTaskAdapterDefinition {
    id: string;
    submitPath: string;
    queryPath: string;
    request: (input: VideoSubmitRequest) => Record<string, unknown>;
    readTaskId: (body: unknown) => string | null;
    readStatus: (body: unknown) => unknown;
    readResult: (body: unknown) => VideoResult | undefined;
  }
  ```

- [ ] **Step 1: 先用 fixture 证明重复协议**

  为 OpenAI 风格 JSON、内容数组风格 JSON 和嵌套任务结果各准备提交成功、查询进行中、查询成功和查询失败 fixture。

- [ ] **Step 2: 实现固定模板**

  模板只允许 `POST` 提交和 `GET` 查询；路径、状态读取和结果读取来自源码中的 definition；供应商参数必须经过显式 allowlist。数据库中的 `submitPath`、`queryPath`、HTTP 方法和响应选择器不再作为运行时配置。

- [ ] **Step 3: 仅重构真正同形的适配器**

  如果现有适配器包含表单、特殊鉴权、媒体上传或不同任务生命周期，保留专用代码，不为了复用强行压平。现有 `adapterConfig.video.vendor.submitPath`、`queryPath` 等旧字段只在迁移时识别为已知默认值，之后忽略用户覆盖；`baseUrl` 统一使用已通过 SSRF 校验的站点地址。

- [ ] **Step 4: 运行多协议测试**

  Expected: 同一个公共请求经过至少三个 fixture 后得到同一 OpenHub 状态和结果结构；不同协议不共享错误的字段映射。

### Task 5: 把 Schema、证据和可执行状态接入运行时

**Files:**
- Modify: `packages/server/src/db/schema/models.ts`
- Modify: `packages/server/src/db/schema/variants.ts`
- Generate: `packages/server/drizzle/`
- Modify: `packages/server/src/engine/discover.ts`
- Modify: `packages/server/src/lib/model-contract.ts`
- Modify: `packages/server/src/engine/param-mapper.ts`
- Modify: `packages/server/src/routes/v1/video.ts`
- Modify: `packages/server/src/routes/admin/variants.ts`
- Create: `packages/server/test-model-execution-status.ts`

**Interfaces:**
- Produces: 模型的 `adapter_version`、契约验证状态、证据来源和不可执行原因。
- Consumes: `models.adapterId`、`models.videoContractSnapshot`、`variants.adapterConfig` 和 manifest `configSchema`。

  运行时证据优先级固定为：

  ```text
  人工确认的供应商契约
    > 已验证适配器 manifest
    > 供应商运行时 Schema
    > 高置信目录匹配
    > 模型名称推断
  ```

- [ ] **Step 1: 增加最小数据库字段**

  在 `models` 增加可空字段 `adapterVersion`、`adapterValidationStatus`、`adapterValidationReason`；在 `variants` 增加 `adapterConfigStatus`、`adapterConfigReason`、`adapterConfigValidatedAt`。保留旧 `adapterId`、Fal 字段和现有视频契约字段；迁移只增加可空字段或带默认值字段，旧数据库无需停机重建。

- [ ] **Step 2: 分离建议与执行合同**

  目录和模型名称只能写入 suggestion/evidence 字段；只有 `confirmed` 契约和已通过 manifest 配置校验的变体才允许进入视频 worker。

- [ ] **Step 3: 禁止静默丢参**

  参数处理规则：

  ```text
  公共字段 -> 公共契约校验和映射
  provider_options -> 当前适配器 allowlist 校验后转发
  未知字段 -> 返回 model_parameter_invalid，不发送上游
  ```

- [ ] **Step 4: 统一错误状态**

  对以下情况分别返回稳定错误码：`adapter_not_found`、`adapter_config_invalid`、`capability_unsupported`、`contract_unconfirmed`、`model_parameter_invalid`。

- [ ] **Step 5: 测试状态门禁**

  Expected: 未确认视频契约、只有提交没有查询、配置 Schema 不通过和未知参数都在上游调用前失败。

### Task 6: 改造站点接入向导和模型管理界面

**Files:**
- Modify: `packages/server/src/routes/admin/sites.ts`
- Modify: `packages/server/src/routes/admin/variants.ts`
- Modify: `packages/server/src/routes/admin/wizard.ts`
- Modify: `packages/web/src/lib/api.ts`
- Modify: `packages/web/src/pages/Sites.tsx`
- Modify: `packages/web/src/pages/Variants.tsx`
- Modify: `packages/web/src/pages/Wizard.tsx`
- Modify: `packages/web/src/pages/Models.tsx`
- Create: `packages/web/src/components/AdapterConfigForm.tsx`
- Create: `packages/server/test-admin-adapter-flow.ts`

**Interfaces:**
- Produces: 管理员可以从 manifest 选择适配器，并看到配置验证、模型发现、契约来源和可执行状态。

- [ ] **Step 1: 固定向导流程**

  页面步骤固定为：

  ```text
  选择适配器 -> 输入站点地址和 Key -> 校验配置 -> 发现模型
  -> 查看模态与证据 -> 确认契约 -> 创建变体
  ```

- [ ] **Step 2: 使用 Schema 渲染配置**

  `AdapterConfigForm` 只渲染 manifest 允许的字段；不提供输入任意路径、任意方法或任意响应选择器的控件。

- [ ] **Step 3: 显示真实状态**

  使用四种明确状态：`可执行`、`需要确认`、`协议不支持`、`连接失败`。不能因为模型名命中目录就显示“正常”。

- [ ] **Step 4: 修复保存中的失败状态**

  前端必须处理创建、发现和 Schema 匹配的独立状态；任何请求失败都恢复按钮状态并显示后端错误码，不得永久显示“保存中”。

- [ ] **Step 5: 浏览器与构建验证**

  使用本地服务验证：新增站点、配置校验失败、模型发现成功、模型契约待确认、创建视频变体和错误恢复；随后运行前端生产构建。

### Task 7: 提供外部软件接入层

**Files:**
- Create: `packages/client/package.json`
- Create: `packages/client/src/index.ts`
- Create: `packages/client/test/client.test.ts`
- Create: `docs/VIDEO-INTEGRATION.md`
- Modify: `README.md`

**Interfaces:**
- Produces: `OpenHubClient.createVideo()`、`getVideoTask()`、`listVideoTasks()`、`waitForVideoTask()`。
- Consumes: OpenHub 的 `/v1/video/*` HTTP API；不直接接触供应商 Key。

  ```ts
  export interface OpenHubClientOptions { baseUrl: string; apiKey: string; fetch?: typeof fetch; }
  export interface VideoTask { id: string; status: VideoTaskStatus; result?: VideoResult | null; error?: string | null; }
  export interface WaitOptions { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal; }

  export class OpenHubClient {
    constructor(options: OpenHubClientOptions);
    createVideo(input: VideoSubmitRequest): Promise<VideoTask>;
    getVideoTask(id: string): Promise<VideoTask>;
    listVideoTasks(): Promise<VideoTask[]>;
    waitForVideoTask(id: string, options?: WaitOptions): Promise<VideoTask>;
  }

  const client = new OpenHubClient({
    baseUrl: "https://openhub.example.com",
    apiKey: process.env.OPENHUB_API_KEY!,
  });

  const task = await client.createVideo({
    model: "selected-variant",
    prompt: "...",
    provider_options: {},
  });
  const result = await client.waitForVideoTask(task.id);
  ```

- [ ] **Step 1: 先固定 HTTP 契约文档**

  文档明确请求、响应、状态、错误、轮询间隔建议、幂等键和回调语义；说明调用方只需要 OpenHub Key，不需要供应商 Key。

- [ ] **Step 2: 实现薄客户端**

  客户端只封装 HTTP、超时、错误码和轮询；不包含 OpenAI、Kling、Wan、MemeFast 等供应商分支。

- [ ] **Step 3: 保护浏览器端使用方式**

  文档明确生产环境推荐由自有后端调用，避免把 OpenHub Key 放进公开浏览器代码；浏览器直连只作为开发场景。

- [ ] **Step 4: 测试客户端**

  使用本地 mock 验证创建、轮询成功、轮询失败、超时、重复请求和结构化错误。

### Task 8: 提供适配器开发工具和安全合规测试

**Files:**
- Modify: `packages/server/package.json`
- Modify: `packages/adapter-sdk/src/conformance.ts`
- Create: `packages/server/src/engine/adapters/conformance.ts`
- Create: `packages/server/test-adapter-conformance.ts`
- Create: `packages/server/test-adapter-security.ts`
- Modify: `packages/server/src/engine/tasks/worker.ts`
- Modify: `packages/server/src/lib/ssrf.ts`
- Modify: `packages/server/src/lib/log.ts`
- Create: `docs/ADAPTER-SDK.md`
- Create: `docs/VIDEO-PROVIDER-EVIDENCE.md`

**Interfaces:**
- Produces: `runAdapterConformance(adapter, fixtures)` 和适配器接入报告。

  ```ts
  export interface VideoAdapterFixture {
    name: string;
    submitResponse: unknown;
    queryResponses: unknown[];
    expectedTaskId: string;
    expectedStatuses: VideoTaskStatus[];
    expectedVideoUrl?: string;
  }

  export interface AdapterConformanceReport {
    adapterId: string;
    passed: boolean;
    checks: Array<{ name: string; passed: boolean; message?: string }>;
  }

  export function runAdapterConformance(
    adapter: VideoProviderAdapter,
    fixtures: VideoAdapterFixture[],
  ): Promise<AdapterConformanceReport>;
  ```

- [ ] **Step 1: 固定合规检查项**

  每个视频适配器必须通过：

  ```text
  manifest 校验
  submit/query 方法存在
  提交响应能读取 siteTaskId
  所有终态能映射
  成功响应能读取 video_url
  失败响应能生成稳定错误
  请求不会输出 API Key、prompt 或媒体 URL
  ```

- [ ] **Step 2: 加入网络安全门禁**

  站点 base URL 继续使用现有 SSRF 校验；适配器路径必须是代码内常量或受限枚举；请求增加 AbortController 超时；GET 查询允许有限重试，POST 只有在幂等键存在时才允许重试。

- [ ] **Step 3: 清理日志和响应**

  对请求体、上游响应和错误信息执行敏感字段清理；任务查询只返回脱敏后的 meta，不返回原始上游响应。

- [ ] **Step 4: 形成证据记录**

  每个适配器记录：协议来源、文档或 fixture、验证日期、支持的能力、未支持的能力、参数 Schema 状态和已知限制。

- [ ] **Step 5: 运行安全测试**

  Expected: 私网地址策略、超时、重试、错误脱敏和敏感字段扫描全部通过；不存在任意 URL/路径执行入口。

- [ ] **Step 6: 注册适配器测试脚本**

  在 `packages/server/package.json` 增加：

  ```json
  "test:adapters": "tsx --test test-adapter-sdk.ts test-adapter-manifest.ts test-adapter-registry.ts test-adapter-template.ts test-adapter-conformance.ts test-adapter-security.ts"
  ```

### Task 9: 用代表性供应商完成试点和发布验收

**Files:**
- Modify: `packages/server/test-fixtures/adapters/`
- Modify: `docs/VIDEO-PROVIDER-EVIDENCE.md`
- Modify: `README.md`
- Modify: `COMPLETION_STATUS.md`

**Interfaces:**
- Produces: 供应商支持矩阵和发布前验收报告。

- [ ] **Step 1: 选择三类试点协议**

  必须覆盖：

  ```text
  一个 OpenAI 风格异步接口
  一个请求或结果结构明显不同的直连接口
  一个使用多模态 content[] 或特殊结果嵌套的接口
  ```

  试点供应商必须有官方文档或固定 fixture；没有证据的供应商不进入“已支持”列表。

- [ ] **Step 2: 验证同一上层应用流程**

  上层只使用 `createVideo`、`getVideoTask` 和统一结果，不增加供应商分支。

- [ ] **Step 3: 验证失败边界**

  分别验证：模型未知、模态未知、契约未确认、参数非法、供应商返回失败、查询超时和结果缺少视频 URL。

- [ ] **Step 4: 运行完整验证**

  ```text
  pnpm typecheck
  pnpm test
  pnpm --filter @openhub/web build
  pnpm --filter @openhub/server test:adapters
  git diff --check
  ```

- [ ] **Step 5: 生成支持矩阵**

  每个供应商只允许以下状态之一：`supported`、`supported_with_review`、`adapter_required`、`unsupported`；不得使用模糊的“理论支持”。

---

## 4. 版本与发布策略

### 4.1 推荐拆分

不要把全部目标做成一个大 PR，按以下三个可独立验收的里程碑推进：

1. **核心边界**：Task 1–3；交付 SDK 类型、manifest、注册表和运行时基线。
2. **视频执行可靠性**：Task 4–5、8；交付协议模板、Schema 门禁、worker 和安全测试。
3. **产品接入体验**：Task 6–9；交付管理向导、外部客户端、文档和试点矩阵。

每个里程碑必须先通过本地测试再进入下一阶段；是否提交或创建 PR 由用户单独确认。

### 4.2 兼容性规则

- `adapterId` 是稳定标识，不按模型名称生成新的适配器 ID。
- `adapterVersion` 用于记录 manifest 版本；旧记录为空时按当前兼容版本校验，不自动改写用户配置。
- 公共视频字段保持向后兼容；供应商新字段只能进入 `provider_options` 或新的已确认契约。
- 旧 Fal 快照继续可读，但不能覆盖已确认的供应商契约。
- MemeFast 继续保持当前非视频能力声明，直到有真实视频协议证据。

### 4.3 失败时的产品行为

```text
能识别模型但没有参数证据 -> 显示“需要确认”，禁止执行
有参数证据但没有提交/查询适配器 -> 显示“适配器缺失”，禁止执行
适配器存在但配置错误 -> 显示“配置无效”，禁止保存可调用变体
请求参数不在契约内 -> 调用前返回结构化错误
供应商返回失败 -> 保留统一错误码和已脱敏供应商原因
```

---

## 5. 完成定义

本计划只有同时满足以下条件才算完成：

- 外部软件可以只依赖 OpenHub 统一视频 API 完成创建、查询和结果展示。
- 新增一个常见协议供应商时，不需要修改上层应用代码。
- 新增一个特殊协议供应商时，只需实现 SDK 适配器并注册，不复制 worker、路由或数据库逻辑。
- 适配器 manifest 能描述能力、配置、版本和证据。
- 模型目录、模型名称和供应商 Schema 的职责边界在代码和界面中一致。
- 所有可执行视频变体同时具备经过验证的提交、查询、参数和结果能力。
- 失败、超时、未确认和不支持状态不会伪装成“正常”。
- 服务端测试、适配器合规测试、类型检查、前端构建和安全检查全部通过。
- 没有引入远程代码执行、任意 HTTP 执行、未验证供应商协议或新的无必要基础设施。

## 6. 计划自检结论

- **需求前提修正：** “所有供应商零配置即插即用”不可保证；计划改为“统一调用 + 常见协议配置接入 + 特殊协议 SDK 接入”。
- **逻辑闭环：** 上层应用、OpenHub 路由、适配器、Schema、worker 和结果查询均有对应任务。
- **维护成本控制：** 不按模型复制代码，不开放任意执行器，不把目录当执行合同，保留专用适配器处理真正的协议差异。
- **证据状态：** 当前代码事实已标明；未来供应商覆盖率、MemeFast 视频能力和通用模板覆盖范围必须通过 fixture 或官方协议验证。
- **长期边界：** OpenHub 是统一模型接入运行时和适配器平台，不是自动猜测所有供应商 API 的万能代理。
