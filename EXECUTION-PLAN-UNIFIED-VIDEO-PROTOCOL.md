# 通用视频协议层实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or execute this plan task-by-task with a review checkpoint after each task. Steps use checkbox ( - [ ] ) syntax for tracking.

**Goal:** 在不硬编码模型名称、不制造万能协议的前提下，统一视频任务的公共生命周期，并让供应商独有参数、请求格式和结果格式都能被验证、映射和追踪。

**Architecture:** 保留 OpenHub 现有异步任务和适配器体系，增加一个与 Fal 无关的视频模型契约。公共层只统一提交、查询、状态、错误、结果和少量跨供应商参数；供应商差异由适配器代码和已确认的模型契约处理，目录只提供建议，不直接成为执行依据。

**Tech Stack:** TypeScript、Hono、Drizzle SQLite、原生 fetch、现有 zod、Node node:test、现有 Vite 本地网页。

## Global Constraints

- 不按具体模型名称增加规则；规则按协议族、供应商契约或运行时证据工作。
- 不把所有供应商字段强行压成公共字段；公共字段与 provider_options 扩展字段并存。
- 不新增任意路径执行器；路径、请求方式、鉴权和响应解析由受审查的适配器代码负责。
- 不把模型目录、Fal Schema 或模型名称推断直接当作可执行供应商合同。
- 未确认的参数不得静默丢弃；返回结构化错误，或进入已验证的供应商扩展区。
- 视频适配器必须同时具备提交和查询能力。
- OpenHub 的 callback_url 表示 OpenHub 对调用方的完成通知；供应商上游回调属于适配器内部能力，不自动透传。
- 不新增 Redis、队列服务、插件市场或多租户凭据系统。
- 不在没有非生产凭据和已确认协议的情况下调用真实计费接口。
- 不提交、不推送、不创建 PR；每个任务只留下可复现的本地验证结果。

---

## 0. 独立分析与证据结论

### 0.1 已确认事实

| ID | 事实 | 本地证据 |
|---|---|---|
| F1 | OpenHub 已有异步视频任务入口、任务表、worker、轮询和回调。 | packages/server/src/routes/v1/video.ts:30；packages/server/src/engine/tasks/worker.ts:100；packages/server/src/db/schema/tasks.ts |
| F2 | 适配器接口已定义 submitVideoTask、queryVideoTask、状态映射和结果转换钩子。 | packages/server/src/engine/adapter.ts:240 |
| F3 | 当前公共视频接口要求顶层 prompt，公共字段主要是 duration、aspect_ratio、参考媒体和回调。 | packages/server/src/routes/v1/video.ts:38-41；DESIGN.md:1435-1472 |
| F4 | worker 根据 Fal 参数快照或请求字段建立白名单，供应商专有字段可能被丢弃。 | packages/server/src/engine/tasks/worker.ts:124-155；packages/server/src/engine/param-mapper.ts:264-293 |
| F5 | transformVideoResult 已定义但没有被 worker 调用，结果标准化分散在各适配器。 | packages/server/src/engine/adapter.ts:243-246；git grep transformVideoResult |
| F6 | 当前模型参数字段和完整快照主要以 Fal 命名，不能直接代表任意供应商模型合同。 | packages/server/src/db/schema/models.ts:69-84 |
| F7 | MemeFast 适配器当前只注册 Chat、Embedding、Image、Audio 和模型发现，没有视频提交/查询。 | packages/server/src/engine/adapters/memefast.ts:33-43；packages/memefast/src/client.ts:23-29 |

### 0.2 供应商协议证据

下表只证明供应商存在不同协议形态，不直接把文档转成运行时合同。

| 证据 | 已观察到的差异 | 来源 |
|---|---|---|
| 用户提供的 PixStag API 摘要 | 提交和查询路径不同；请求使用 content[]；内容有文本、图片、视频、音频和 role；任务返回嵌套 task、结果 URL、比例、分辨率和用量。 | 用户本轮提供的 PixStag 文档 |
| OpenAI Videos API | 视频任务创建和检索是两个操作；请求和任务结果字段不同于 Chat/Images API。 | https://platform.openai.com/docs/api-reference/videos |
| Alibaba Model Studio 视频 API | 使用异步提交和任务查询；任务 ID、状态和结果位于供应商定义的输出结构中。 | https://help.aliyun.com/zh/model-studio/developer-reference/api-reference-video |
| Volcano Ark 内容生成任务 | 使用 content[] 多模态输入和异步任务查询；返回任务状态与内容数组。 | https://www.volcengine.com/docs/82379/1399567 |
| AWS Bedrock Nova Reel | 使用异步启动和异步查询；模型输入和输出存储语义由服务定义，不等于 URL 结果。 | https://docs.aws.amazon.com/nova/latest/userguide/video-gen-access.html |
| Google Veo | 使用长时间运行操作和操作查询；生成配置包含供应商特有的视频参数。 | https://cloud.google.com/vertex-ai/generative-ai/docs/video/generate-videos |

### 0.3 合理推测

1. OpenHub 的合理目标是统一调用和可靠适配，不是让供应商原始请求 JSON 变成同一个 JSON。
2. 同一供应商可能存在多个版本和多个异步协议，适配器应按协议族和版本维护，不应按模型名称复制代码。
3. 模型目录适合补全身份和展示建议；可执行参数必须来自供应商 Schema、运行时元数据、适配器 manifest 或管理员确认。

### 0.4 未验证假设

1. MemeFast 当前是否公开视频提交、查询、回调和结果下载接口，当前代码不能证明。
2. MemeFast 返回的模型参数是否足以生成完整视频输入契约，当前代码不能证明。
3. 现有五个视频适配器的真实供应商返回字段是否与代码注释完全一致，必须用官方文档或固定 mock fixture 逐个核验。

### 0.5 结论

问题不是“供应商自定义所以无法解决”，而是当前系统缺少三层边界：

1. 公共任务层：提交、查询、状态、错误、结果、回调。
2. 模型输入契约层：必填、类型、枚举、默认值、嵌套对象和媒体数量限制。
3. 供应商适配层：路径、请求转换、状态映射、结果提取和供应商扩展参数。

本计划只补这三层，不建设任意 HTTP 执行器，也不承诺未经证据验证的供应商能力。

---

## 1. 产品边界与验收口径

### 1.1 P0 必须完成

- 统一视频任务创建和查询接口保持兼容。
- 允许 prompt 或规范化多模态内容作为输入，不再无条件要求顶层 prompt。
- 公共字段支持模型、提示词、时长、比例、分辨率、参考媒体、幂等键和 OpenHub 回调。
- 供应商扩展参数使用明确命名空间，不再静默丢弃。
- 模型保存来源中立的视频输入契约和证据状态。
- 契约支持必填、类型、枚举、默认值、数组数量、嵌套对象和内容项角色。
- worker 只信任适配器返回的标准状态和标准结果。
- 标准结果可保留视频 URL、封面、时长、宽高、比例、分辨率、用量和供应商扩展元数据。
- 现有 OpenAI、Kling、Wan、Seedance、Grok 适配器都有独立 fixture 和状态/结果测试。
- 未确认的供应商视频能力显示为不可执行或需要复核，而不是显示“正常”。

### 1.2 P1 明确延后

- MemeFast 原生视频提交、查询、回调和媒体上传；必须等 MemeFast 的真实协议或确定文档 fixture。
- AWS S3、Google long-running operation 等非 URL 结果存储的下载代理。
- 视频任务取消、暂停、优先级和跨实例队列。
- 自动抓取任意供应商文档并直接激活执行合同。

### 1.3 明确非目标

- 不为每个模型增加一段名称判断代码。
- 不把 Fal 目录复制成第二套供应商目录。
- 不让调用方传入任意 URL、HTTP 方法或响应路径来控制服务端请求。
- 不为了“字段完整”接受未经验证的未知参数。
- 不因为目录命中就断言某个站点账号真的开放该模型或参数。

### 1.4 最终验收场景

同一个 OpenHub 请求经过三个协议 fixture：

~~~text
统一请求
  -> 公共契约校验
  -> 适配器转换
  -> 各自提交接口
  -> 各自查询接口
  -> 统一状态与结果
  -> OpenHub 任务查询与回调
~~~

验收必须证明：

- 同一公共参数可以被不同适配器正确转换。
- 供应商私有参数不会被静默删除。
- 非法类型、非法枚举、缺少嵌套必填字段会在上游调用前失败。
- queued、running、succeeded、failed、cancelled 等状态能映射到 OpenHub 状态。
- 结果 URL 不在固定位置时仍能由对应适配器提取。
- 查询接口不泄露用户原始 prompt、媒体 URL、API key 或上游完整敏感响应。

---

## 2. 文件地图

### 新增

- Create: docs/VIDEO-PROTOCOL-EVIDENCE.md — 供应商协议、字段来源、fixture 和验证日期。
- Create: packages/server/src/engine/video/contract.ts — 来源中立的视频契约类型、解析和递归校验。
- Create: packages/server/src/engine/video/normalize.ts — 公共状态、结果和错误标准化辅助函数。
- Create: packages/server/test-video-contract.ts — 契约校验和证据优先级测试。
- Create: packages/server/test-video-adapters.ts — 代表性供应商协议 fixture 测试。
- Create: packages/server/test-video-worker.ts — 提交、轮询、终态、结果和回调测试。
- Create: packages/server/test-fixtures/video/openai.json — OpenAI 风格任务 fixture。
- Create: packages/server/test-fixtures/video/dashscope.json — DashScope 风格任务 fixture。
- Create: packages/server/test-fixtures/video/content-array.json — content 数组风格任务 fixture。

### 修改

- Modify: packages/server/src/db/schema/models.ts — 增加来源中立的视频契约快照及证据状态。
- Generate: packages/server/drizzle/0007_add-video-contract.sql — 增加契约列并保留旧 Fal 字段。
- Modify: packages/server/src/engine/adapter.ts — 定义公共视频请求、内容项、结果元数据和供应商扩展类型。
- Modify: packages/server/src/engine/param-mapper.ts — 让视频请求使用契约白名单和显式扩展区，禁止静默丢弃。
- Modify: packages/server/src/lib/model-contract.ts — 优先读取已确认的来源中立契约，兼容已确认 Fal 快照。
- Modify: packages/server/src/routes/v1/video.ts — 校验公共请求与嵌套内容，保持旧字段兼容。
- Modify: packages/server/src/engine/tasks/worker.ts — 使用适配器标准状态/结果，调用结果转换兜底并保存扩展元数据。
- Modify: packages/server/src/routes/admin/variants.ts — 视频变体同时要求 submit/query 能力。
- Modify: packages/server/src/engine/adapters/openai.ts — 统一任务结果处理并补齐字段映射。
- Modify: packages/server/src/engine/adapters/kling.ts — 补齐状态、结果元数据和错误映射。
- Modify: packages/server/src/engine/adapters/wan.ts — 补齐直接模式与 New API 模式的公共结果映射。
- Modify: packages/server/src/engine/adapters/seedance.ts — 统一 content 数组结果和状态映射。
- Modify: packages/server/src/engine/adapters/grok.ts — 统一结果元数据和失败/过期状态。
- Modify: packages/server/src/engine/discover.ts — 从明确运行时 metadata 提取建议契约，不把建议直接变成执行合同。
- Modify: packages/server/src/routes/admin/models.ts、packages/server/src/routes/admin/wizard.ts — 展示并确认视频契约证据。
- Modify: packages/web/src/pages/Models.tsx、packages/web/src/pages/Sites.tsx — 显示契约来源、状态和不可执行原因。
- Modify: packages/server/src/scripts 或 package.json — 注册视频契约和适配器测试命令。
- Modify: DESIGN.md:688-732、DESIGN.md:1435-1472 — 更新公共层/扩展层边界和验收契约。

---

## 3. 任务分解

### Task 1: 固定协议证据和测试 fixture

**Files:**
- Create: docs/VIDEO-PROTOCOL-EVIDENCE.md
- Create: packages/server/test-fixtures/video/openai.json
- Create: packages/server/test-fixtures/video/dashscope.json
- Create: packages/server/test-fixtures/video/content-array.json

**Interfaces:**
- Produces: 每个 fixture 都包含 submitRequest、submitResponse、queryResponses、statusMap 和 resultPathDescription。
- Consumes: 本计划 0.2 的官方文档和当前适配器代码。

- [ ] Step 1: 写证据登记表。

在 docs/VIDEO-PROTOCOL-EVIDENCE.md 记录每个供应商的 submit method/path、query method/path、task id path、status path、result URL path、source 和 verified_at。

没有被官方文档、真实响应或 deterministic mock 证明的字段标记为 unverified，不写入运行时合同。

- [ ] Step 2: 写三类最小 fixture。

fixture 至少覆盖：

~~~json
{
  "submitResponse": { "id": "task_1", "status": "queued" },
  "queryResponses": [
    { "id": "task_1", "status": "running" },
    { "id": "task_1", "status": "succeeded", "result": { "video_url": "https://example.test/v.mp4", "duration": 5 } }
  ]
}
~~~

第二个 fixture 使用嵌套输出任务 ID 和状态，第三个 fixture 使用 content[] 结果，确保测试不依赖某一个供应商名称。

- [ ] Step 3: 运行 fixture JSON 校验。

运行：

~~~powershell
Get-ChildItem packages/server/test-fixtures/video/*.json | ForEach-Object { Get-Content -Raw $_.FullName | ConvertFrom-Json | Out-Null }
~~~

预期：三个 fixture 都能被 PowerShell JSON 解析，不存在空 task ID、状态或结果 URL。

### Task 2: 增加来源中立的视频模型契约

**Files:**
- Create: packages/server/src/engine/video/contract.ts
- Modify: packages/server/src/db/schema/models.ts
- Generate: packages/server/drizzle/0007_add-video-contract.sql
- Modify: packages/server/src/lib/model-contract.ts
- Test: packages/server/test-video-contract.ts

**Interfaces:**

定义最小递归参数规格，不实现完整 JSON Schema：

~~~typescript
export type VideoParameterType =
  | "string"
  | "integer"
  | "number"
  | "boolean"
  | "object"
  | "array";

export interface VideoParameterSpec {
  type: VideoParameterType;
  required?: boolean;
  enum?: Array<string | number | boolean>;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  properties?: Record<string, VideoParameterSpec>;
  requiredProperties?: string[];
  items?: VideoParameterSpec;
}

export interface VideoInputContract {
  version: 1;
  fields: Record<string, VideoParameterSpec>;
  required: string[];
}

export interface VideoContractEvidence {
  source: "runtime" | "provider_doc" | "manual" | "catalog";
  status: "unverified" | "candidate" | "partial" | "confirmed";
  reason: string;
}
~~~

模型表增加 videoContractSnapshot、videoContractSource、videoContractStatus、videoContractReason 和 videoContractSyncedAt。

- [ ] Step 1: 写失败测试。

在 packages/server/test-video-contract.ts 添加：

~~~typescript
assert.equal(validateVideoContractRequest(
  { content: [{ type: "text", text: "make a video" }], duration: 5 },
  contentArrayContract,
), null);

assert.match(
  validateVideoContractRequest(
    { content: [{ type: "image_url" }] },
    contentArrayContract,
  ) ?? "",
  /url|required/i,
);
~~~

- [ ] Step 2: 实现递归校验。

只实现 type、required、enum、数字边界、数组数量、对象属性和 items；遇到不支持的 Schema 结构返回 contract_unverified，不得默认为合法。

- [ ] Step 3: 实现契约读取优先级。

顺序固定为：

~~~text
confirmed videoContractSnapshot
  > confirmed falInputSchemaSnapshot 的兼容解析
  > runtime candidate 仅展示
  > catalog candidate 仅展示
  > 无契约：只允许适配器声明的公共字段
~~~

candidate、partial 和 unverified 契约不能参与运行时限制。

- [ ] Step 4: 生成并检查数据库迁移。

运行：

~~~powershell
pnpm --filter @openhub/server db:generate
~~~

确认迁移只增加视频契约列，不重建 models 表，不删除旧 Fal 字段，不改写人工覆盖数据。

- [ ] Step 5: 运行契约测试。

运行：

~~~powershell
pnpm --filter @openhub/server exec tsx --test test-video-contract.ts
~~~

预期：公共字段、嵌套内容、非法枚举、非法类型和未确认契约测试全部通过。

### Task 3: 建立统一视频请求和扩展参数边界

**Files:**
- Modify: packages/server/src/engine/adapter.ts
- Modify: packages/server/src/engine/param-mapper.ts
- Modify: packages/server/src/lib/model-contract.ts
- Modify: packages/server/src/routes/v1/video.ts
- Modify: packages/server/src/engine/tasks/worker.ts
- Test: packages/server/test-video-contract.ts

**Interfaces:**

公共请求保持 snake_case 并向后兼容：

~~~typescript
export interface VideoContentPart {
  type: "text" | "image" | "video" | "audio";
  text?: string;
  url?: string;
  role?: string;
}

export interface VideoSubmitRequest {
  model: string;
  prompt?: string;
  content?: VideoContentPart[];
  duration?: number;
  aspect_ratio?: string;
  resolution?: string;
  callback_url?: string;
  idempotency_key?: string;
  provider_options?: Record<string, unknown>;
  [key: string]: unknown;
}
~~~

- [ ] Step 1: 修改入口条件。

将 packages/server/src/routes/v1/video.ts 的“必须有非空 prompt”改为：prompt 非空，或 content 中至少存在一个非空 text；模型契约声明的其他必填项继续校验。

不能凭空从媒体 URL 生成 prompt。

- [ ] Step 2: 定义扩展命名空间。

约定：

~~~json
{
  "model": "openhub-video-variant",
  "prompt": "common prompt",
  "duration": 5,
  "provider_options": {
    "adapter_id": {
      "private_parameter": "value"
    }
  }
}
~~~

适配器只能读取自己的扩展命名空间；公共层不得把任意对象展开到请求顶层。

- [ ] Step 3: 修改参数映射不变量。

视频映射固定为：

~~~text
公共字段 -> 变体字段映射 -> 已确认契约字段 -> 适配器扩展字段 -> 供应商请求
~~~

未确认且未显式映射的字段返回 unknown_parameter 或 contract_unverified，不能沿用默认丢弃。

- [ ] Step 4: 保持旧请求兼容。

继续接受 reference_image_urls、reference_video_urls 和 reference_audio_urls，由适配器或公共归一化函数转换为供应商需要的输入；旧调用方不必立即改成 content。

- [ ] Step 5: 运行入口测试。

覆盖 prompt、content 文本和只有媒体没有文本三种请求，最后一种必须在上游调用前返回缺少文本的结构化错误。

### Task 4: 修正任务 worker 的状态和结果标准化

**Files:**
- Create: packages/server/src/engine/video/normalize.ts
- Modify: packages/server/src/engine/adapter.ts
- Modify: packages/server/src/engine/tasks/worker.ts
- Modify: packages/server/src/engine/tasks/service.ts
- Modify: packages/server/src/routes/v1/video.ts
- Test: packages/server/test-video-worker.ts

**Interfaces:**

~~~typescript
export type VideoTaskStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "timeout";

export interface VideoResult {
  video_url: string;
  cover_url?: string;
  duration?: number;
  width?: number;
  height?: number;
  ratio?: string;
  resolution?: string;
  usage?: Record<string, number>;
  task_type?: string;
  modality?: string;
  provider_metadata?: Record<string, unknown>;
}
~~~

- [ ] Step 1: 让视频变体同时要求 submit/query。

修改 validateAdapterCapability，视频适配器缺少任一能力时返回 adapter_capability_unsupported。

- [ ] Step 2: 让 worker 信任适配器的标准状态。

worker 不再从 raw.status 猜测状态；queryVideoTask 必须返回已映射的 status。原始响应只用于诊断，不作为状态机输入。

- [ ] Step 3: 调用结果转换兜底。

兼容现有适配器：

~~~typescript
const normalizedResult =
  result.result ??
  (adapter.transformVideoResult && result.raw
    ? adapter.transformVideoResult(result.raw)
    : undefined);
~~~

若终态为 completed 但没有 video_url，任务必须转为 failed，并记录 missing_video_result，不能显示成功。

- [ ] Step 4: 保存可安全展示的结果元数据。

只保存规范化结果和允许的供应商元数据；不保存原始 prompt、媒体 URL、API key 或未经筛选的上游响应。

- [ ] Step 5: 测试状态机。

覆盖 queued -> pending、running -> processing、succeeded -> completed、failed -> failed、cancelled/canceled -> failed，以及 completed without video_url -> failed。

### Task 5: 复核并收敛现有视频适配器

**Files:**
- Modify: packages/server/src/engine/adapters/openai.ts
- Modify: packages/server/src/engine/adapters/kling.ts
- Modify: packages/server/src/engine/adapters/wan.ts
- Modify: packages/server/src/engine/adapters/seedance.ts
- Modify: packages/server/src/engine/adapters/grok.ts
- Test: packages/server/test-video-adapters.ts

- [ ] Step 1: 为每个适配器写协议 fixture 测试。

每个测试必须断言 submitVideoTask 返回 siteTaskId，queryVideoTask 返回合法标准状态和终态结果。

- [ ] Step 2: 统一请求转换。

适配器只负责把公共请求和自己命名空间的扩展转换为供应商请求；不得在适配器内根据具体模型名称分支。

- [ ] Step 3: 统一结果转换。

将各自的任务 ID、状态、URL、时长、宽高、比例、分辨率和用量映射到现有 VideoResult；无法证明的字段保持缺省，不猜测。不要再创建第二套结果类型。

- [ ] Step 4: 统一错误信息。

错误至少包含适配器 ID、操作名、HTTP 状态和供应商错误消息；不得包含 API key、Authorization header 或完整用户输入。

- [ ] Step 5: 运行适配器测试。

~~~powershell
pnpm --filter @openhub/server exec tsx --test test-video-adapters.ts
~~~

预期：五个现有适配器均能通过自己的 fixture；不要求它们共享供应商路径或原始字段。

### Task 6: 接入模型发现、目录建议和人工确认

**Files:**
- Modify: packages/server/src/engine/discover.ts
- Modify: packages/server/src/routes/admin/models.ts
- Modify: packages/server/src/routes/admin/wizard.ts
- Modify: packages/web/src/pages/Models.tsx
- Create or modify: docs/VIDEO-PROTOCOL-EVIDENCE.md

- [ ] Step 1: 从运行时 metadata 生成候选契约。

仅当上游明确返回 parameters、input_schema 或等价结构时生成 candidate；没有结构证据时只记录视频能力，不生成参数合同。

- [ ] Step 2: 显示证据来源。

模型页面显示契约状态、来源和具体证据原因：unverified、candidate、partial、confirmed；来源为 runtime、provider_doc、manual 或 catalog。

- [ ] Step 3: 增加显式确认动作。

管理员确认后写入已校验的契约快照、来源、状态和说明，同时写入审计日志 model.video-contract.confirm。

- [ ] Step 4: 防止目录越权。

目录同步只能更新 candidate 建议；不得覆盖 confirmed 契约、人工覆盖字段或适配器配置。

- [ ] Step 5: 运行本地网页验证。

确认已确认契约显示可执行参数，candidate 只显示复核提示，未验证模型不能显示为参数“正常”，缺少 query 能力的视频变体不能创建。

### Task 7: MemeFast 视频能力证据闸门

**Files:**
- Modify only after evidence is checked: packages/memefast/src/types.ts
- Modify only after evidence is checked: packages/memefast/src/client.ts
- Modify only after evidence is checked: packages/server/src/engine/adapters/memefast.ts
- Test: packages/server/test-video-adapters.ts

- [ ] Step 1: 固定 MemeFast 视频协议证据。

在 docs/VIDEO-PROTOCOL-EVIDENCE.md 记录真实提交路径、查询路径、请求体、任务 ID、状态、结果和回调语义。只有文档或真实非生产响应证明的字段才能进入 fixture。

- [ ] Step 2: 无证据时保持明确不支持。

如果没有完整提交/查询协议，memefastAdapter 不增加 video.submit 或 video.query；页面显示“视频协议未验证”，不得复用 OpenAI、Wan 或 Seedance 路径。

- [ ] Step 3: 有完整证据时实现薄适配器。

只增加 submitVideoTask、queryVideoTask、mapVideoStatus 和 transformVideoResult。MemeFast connector 只负责传输和错误封装，不复制 OpenHub 数据库或目录逻辑。

- [ ] Step 4: 运行独立 connector 测试。

~~~powershell
pnpm --filter @openhub/server exec tsx --test test-memefast-adapter.ts test-video-adapters.ts
~~~

没有视频协议 fixture 时，测试必须断言能力被拒绝且错误码为 capability_unsupported。

### Task 8: 文档、回归测试和本地验收

**Files:**
- Modify: DESIGN.md:688-732
- Modify: DESIGN.md:1435-1472
- Modify: packages/server/package.json
- Modify: packages/server/tools/mock-newapi-video-server.ts
- Test: packages/server/test-video-contract.ts
- Test: packages/server/test-video-adapters.ts
- Test: packages/server/test-video-worker.ts

- [ ] Step 1: 更新设计文档。

明确写出：

~~~text
公共层 = OpenHub 任务协议
契约层 = 已验证的模型输入规则
适配器层 = 供应商请求/响应协议
目录 = 建议和身份补全，不是执行合同
~~~

- [ ] Step 2: 扩展本地 mock。

mock 支持至少三种不同的提交/查询响应结构，不使用真实供应商名称决定逻辑。

- [ ] Step 3: 运行聚焦测试。

~~~powershell
pnpm --filter @openhub/server exec tsx --test test-video-contract.ts test-video-adapters.ts test-video-worker.ts
~~~

- [ ] Step 4: 运行现有回归。

~~~powershell
pnpm --filter @openhub/server test
pnpm --filter @openhub/server typecheck
pnpm --filter @openhub/web build
~~~

前序 scripts/* 或 wizard 的无关类型错误不得被包装成视频功能通过，需单独记录。

- [ ] Step 5: 本地网页端到端验证。

使用本地网页和本地 mock 完成：创建站点、发现视频模型、确认或拒绝视频契约、创建视频变体、提交、查询、等待 worker 完成、验证 result/error/status/callback。

- [ ] Step 6: 记录最终边界。

验收报告把每个字段分成：已验证可执行、已发现但仅可展示、供应商特有且需扩展、当前不支持。

---

## 4. 长期维护判断

### 可维护的部分

- 新供应商只需新增或扩展协议适配器和 fixture。
- 模型名称变化不会破坏协议映射。
- 目录更新不会直接改变线上执行行为。
- 公共任务 API 与供应商原始 API 解耦。
- 未知字段显式报错，便于发现协议漂移。

### 明确接受的成本

- 每个新协议族都需要官方证据、适配器代码和 fixture。
- 供应商 API 版本变化需要更新适配器和契约版本。
- 同一模型在不同站点的可用参数不能只依赖目录判断。

### 明确拒绝的成本

- 不维护按模型名称增长的规则表。
- 不维护可以执行任意 URL 和 JSONPath 的动态引擎。
- 不为每个供应商复制完整任务系统。
- 不把未经验证的目录参数伪装成“支持”。

---

## 5. 实施完成后的预期

实施后，OpenHub 将成为：

> **统一视频任务入口 + 可审计的视频模型参数契约库 + 供应商协议适配层。**

用户看到统一的创建、查询、状态、结果和错误接口；开发者添加新供应商时，只需提供已验证的参数契约、请求转换、查询解析和测试 fixture。供应商独有能力不会消失，也不会污染公共接口。

这能解决“统一使用和可靠适配”；不能承诺“只凭模型名称自动知道所有私有参数”。后者必须依赖供应商文档、运行时 Schema、真实响应或人工确认。
