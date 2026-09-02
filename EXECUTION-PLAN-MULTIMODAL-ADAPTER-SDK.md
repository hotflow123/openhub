# OpenHub 多模态适配器运行时与 SDK 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or execute this plan task-by-task with a review checkpoint after each task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 OpenHub 建设为 LLM、Embedding、图片、音频和视频的统一模型接入运行时：上层网站或软件只调用 OpenHub 的稳定接口，供应商通过受审查、可版本化的适配器包或协议模板接入；借鉴 `new-api-plugins` 的 manifest、生命周期钩子、版本不可变和合规校验，但不复制其运行时或远程插件执行方式。

**Revision:** 2026-08-31，基于本地 `new-api-plugins` 提交 `8879009` 的复核结果，以及 MemeFast 视频模型参数显示问题修订；本版明确将 fal.ai Schema 升级为“可应用的参数模板决策源”，而不是只读百科。

**Architecture:** 以“公共 API/入站协议 + 供应商适配器 + 模态专属契约 + 执行生命周期”为边界。聊天、Embedding、图片、音频和视频共享站点、模型、变体、密钥、错误和证据机制，但保留各自的请求、响应、流式、二进制和异步任务语义。适配器 manifest 描述身份、模型绑定、能力、任务策略、用量和产物；代码钩子负责请求构造、响应解析、状态映射和结果渲染。常见协议使用代码内置模板，特殊协议使用 SDK 适配器；目录和索引只负责发现、完整性和展示，不直接成为执行合同。

**Tech Stack:** TypeScript、Hono、Drizzle SQLite、原生 `fetch`、Zod、Node `node:test`、Vite、pnpm workspace、Node 22 LTS。

## 执行状态（2026-08-31）

- `[x]` 多模态 SDK、manifest、注册表、契约门禁、适配器索引和安全测试已落地。
- `[x]` LLM、Embedding、图片、音频和 P0 逐任务视频统一入口已通过本地 fixture 验证。
- `[x]` 管理端、外部薄客户端、Node/pnpm 固定、数据库备份和 CI 基线已落地。
- `[x]` 本地服务与 8 个管理页面已验收；无运行时控制台错误和嵌套按钮。
- `[x]` 已使用已保存 MemeFast Key 完成健康检查和模型发现 Smoke Test；未创建视频生成任务。
- `[x]` MemeFast 已按受审查协议族接入视频提交/查询，并用本地 fixture 验证；真实计费视频接口 Smoke Test 仍未执行。
- `[ ]` 目录 Schema 与供应商执行契约的边界仍需完成一次产品级纠偏；fal.ai Schema 要通过兼容性证据决定“模板是否可应用”，不能只停留在参考展示。
- `[ ]` MemeFast 的四类模型参数需要按“已应用 fal 模板 / 适配器映射参数 / 未确认参数”分层展示、映射和验证。
- `[ ]` `@openhub/client` npm 发布与远程 CI 实际运行尚未完成。

这里的执行状态优先于下方原始任务复选框；原始复选框是设计阶段工作表，后续应按证据逐项回填，不得用勾选替代真实联调。

## Global Constraints

- 产品范围必须同时覆盖 `llm`、`embedding`、`image`、`audio`、`video`；视频是最复杂的验收场景，不是产品边界。
- 不承诺所有供应商零代码接入；目标是所有已验证适配器都遵守同一套 OpenHub 多模态 API。
- 不把所有模态强行压成一个请求格式；共享生命周期、错误和证据，不共享不适用的参数。
- 不创建任意 HTTP 方法、任意 URL、任意响应路径可由用户填写的通用执行器。
- 供应商地址和 API Key 可以由管理员配置；请求路径、鉴权策略、状态解析和结果解析必须来自代码内受审查的适配器或受信任模板。
- 模型名称只能用于身份和模态分类建议，不能单独生成可执行参数合同。
- 已验证适配器 manifest 可以对明确模型 ID、别名或受审查的前缀规则提供“模型身份”证据，但“已识别模型”与“参数契约已确认”必须是两个独立状态。
- 模型目录只提供身份、厂商、模型族和参数建议；供应商 Schema、适配器 manifest 或人工确认才是运行时依据。
- **模板决策与执行分离：** fal.ai Schema 是 OpenHub 的重要参数模板来源，可以决定模板是否适用于某个模型；但真正发请求、改字段、查任务和解析结果仍必须由供应商适配器完成。
- **模板应用必须有证据：** fal Schema 只有在身份/模态/操作匹配，且适配器声明了对应的协议兼容和字段映射后，才能从 `candidate` 变为 `confirmed/applied`；不允许只凭相似名称直接套用。
- **参数分层：** 已应用的 fal 模板提供统一参数表单和基础校验；适配器负责把模板字段映射为供应商字段；供应商专属参数通过已声明的 `provider_options` 或扩展契约传递；未确认字段不得静默丢失。
- **变体是覆盖层：** 模板是基线，不是锁死的配置。变体可以覆盖比例、分辨率、时长、参考图片/视频/音频数量等常见运行参数；只要字段属于适配器能力且最终值符合供应商已知边界，就不能因为它不是模板默认值而拒绝。
- **缺少目录 Schema 不等于不可用：** 已验证适配器可以执行基础请求时，参数完整度显示为 `unknown/partial`，执行状态仍按真实适配器能力计算；只有适配器、路由、配置或必要契约缺失时才阻断调用。
- **禁止错误映射污染：** 一个候选 fal endpoint 与 MemeFast 模型名相似，不得覆盖 MemeFast 的请求路径、字段、状态、结果解析或可执行状态。
- 未确认的参数不得静默丢弃；必须进入已验证的 `provider_options`，或在上游调用前返回结构化错误。
- 一个适配器声明的能力必须与实际方法一致；视频必须同时具备提交和查询能力。
- API Key 必须加密存储、仅在内存中解密使用，不进入日志、错误响应、任务结果或测试快照。
- 默认只使用固定 fixture 和本地 mock；没有明确的非生产凭据时，不调用真实计费接口。
- 适配器的请求构造、状态解析、结果解析和鉴权策略只能来自已安装源码；管理员不能在数据库中填写任意 HTTP 方法、路径或响应选择器。
- 适配器 manifest 必须记录 `id`、不可变 `version`、模型绑定、协议能力、执行策略、用量 Schema、产物能力、鉴权方式和证据；版本变更必须发布新版本。
- 生成的适配器索引可包含路径、版本和 SHA256，但索引是缓存，不是信任根；运行时必须重新校验源码/manifest。
- `new-api-plugins` 的 `channelTypes`、单文件无依赖运行时和原生协议名称不直接成为 OpenHub 的公共契约。
- P0 不新增 Redis、外部队列、插件市场、远程代码下载、远程 JS 执行、多租户计费或对象存储代理。
- SDK 使用组合式能力接口；适配器只实现自己声明的能力，不能因为支持单一模态而承担五种模态的空实现。
- 计划按垂直切片执行；首个切片必须同时验证 LLM 非流式、LLM 流式和一个 `per_task` 异步任务，不能只验证类型是否能编译。
- 单个内置适配器校验失败时进入 `invalid/quarantined` 状态，不阻断其他有效适配器；仅当没有任何有效适配器时阻止服务进入可调用状态。
- P0 不为前端或上游响应引入缓存；并发上限和超时先用现有机制实现，限流、缓存和连接池只有在运行指标证明必要后再立项。
- SDK 包不依赖 Hono、Drizzle、SQLite 或 Web UI；服务端只负责注册和运行已安装的受信任适配器包。
- 当前项目使用 Node 22 LTS 验证；Node 24 不作为当前 `better-sqlite3` 的支持运行时。
- 不自动提交、推送或创建 PR；每个阶段只留下可审阅的工作树变更和可复现验证结果。

---

## 0. 独立分析与证据结论

### 0.1 已确认事实

| ID | 事实 | 本地证据 |
|---|---|---|
| F1 | 当前 `Adapter` 接口已经同时包含聊天、Embedding、图片、音频和视频方法。 | `packages/server/src/engine/adapter.ts` |
| F2 | 当前路由已分别提供聊天、Embedding、图片、音频和视频入口。 | `packages/server/src/routes/v1/chat.ts`、`embeddings.ts`、`images.ts`、`audio.ts`、`video.ts` |
| F3 | 当前服务端使用注册表按 `adapterId` 解析适配器，并在模型和站点层保存适配器来源。 | `packages/server/src/engine/adapter.ts`、`packages/server/src/engine/index.ts`、`packages/server/src/db/schema/models.ts`、`sites.ts` |
| F4 | 当前已经存在 OpenAI、Kling、Wan、Seedance、Grok 和 MemeFast 内置适配器。 | `packages/server/src/engine/adapters/` |
| F5 | 当前适配器的请求路径、请求体、鉴权、状态、结果和模态覆盖范围并不相同。 | `packages/server/src/engine/adapters/*.ts` |
| F6 | 当前 `models.modality` 已覆盖 `llm`、`image`、`audio`、`video`、`embedding`、`unknown`。 | `packages/server/src/db/schema/models.ts` |
| F7 | 当前 `variants` 已保存参数覆盖、阻断、映射、限制和适配器配置。 | `packages/server/src/db/schema/variants.ts` |
| F8 | 当前视频使用异步任务表和 worker；聊天还存在流式语义，音频存在二进制响应语义。 | `packages/server/src/db/schema/tasks.ts`、`packages/server/src/engine/tasks/worker.ts`、`packages/server/src/routes/v1/chat.ts`、`audio.ts` |
| F9 | 当前目录、运行时元数据和名称推理已经被分开记录，不能直接当作站点真实能力。 | `packages/server/src/engine/catalog/`、`packages/server/src/engine/discover.ts` |
| F10 | MemeFast 当前适配器支持模型发现、聊天、Embedding、图片和音频，没有视频提交与查询方法。 | `packages/server/src/engine/adapters/memefast.ts` |
| F11 | 当前分支的服务端测试 `61/61` 通过，工作区全量测试、类型检查和前端构建通过；Node 24 加载 `better-sqlite3` 时发生 ABI 不匹配，Node 22 可以正常加载。 | 本地测试结果和原生模块加载结果 |
| F12 | `new-api-plugins` 当前包含 10 个 `tasks` 插件目录，均为供应商/任务适配器，不是通用多模态模型目录。 | `new-api-plugins/plugins/tasks/`、`index.json` |
| F13 | 插件 meta 声明模型列表、协议绑定、能力描述、`fetchMode`、用量 Schema 和可选路由信息。 | `new-api-plugins/plugins/tasks/*/1.0.0/plugin.js` |
| F14 | 插件通过构造请求、解析提交响应、构造查询、解析状态/结果、提取用量、列出产物和渲染结果等钩子承载供应商差异。 | `new-api-plugins/plugins/tasks/*/1.0.0/plugin.js` |
| F15 | 插件仓库通过生成的 `index.json` 提供版本、路径和 SHA256；CI 校验插件编译结果、目录命名和索引新鲜度，发布版本目录不可变。 | `new-api-plugins/README.md`、`docs/marketplace.md`、`.github/workflows/validate.yml` |
| F16 | 插件至少存在 `per_task` 和 `batch`/动态查询两类任务取数策略，并有视频、多模态输入、音乐结果等不同产物形态。 | 各 `plugin.js` 的 `fetchMode`、`buildBatchQueryRequest`、`listArtifacts` |
| F17 | 该仓库说明已安装插件拥有管理员级信任，索引字段只是派生信息；直接把其 JS 下载并执行到 OpenHub 会扩大凭据、网络和供应链风险。 | `new-api-plugins/README.md`、`docs/marketplace.md` |
| F18 | 当前 OpenHub 测试采用 `packages/server/test-*.ts` 的扁平命名和独立 fixture 目录，前端主要使用 React Query 与页面级 `useState`，没有证据表明必须引入新的全局状态库。 | `packages/server/test-*.ts`、`packages/web/src/pages/*.tsx`、`packages/web/package.json` |

### 0.2 已观察到的模态差异

| 模态 | 统一层可以统一的部分 | 不能强行统一的部分 |
|---|---|---|
| LLM | 模型、消息、统一错误、非流式响应、流式事件、用量 | 上下文窗口、推理字段、工具调用、结构化输出和供应商消息格式 |
| Embedding | 模型、单条或批量输入、向量结果、用量 | 输入数量限制、维度、编码格式和供应商批处理限制 |
| Image | 模型、提示词、参考图、图片结果和错误 | 生成、编辑、变体接口、multipart、尺寸、质量和返回格式 |
| Audio | 模型、文本或媒体输入、音频结果和错误 | TTS、STT、音频格式、二进制响应、字幕和时间戳 |
| Video | 模型、内容、任务状态、错误、结果和回调 | 提交/查询路径、异步生命周期、媒体上传、结果存储和供应商私有参数 |
| 异步任务 | 提交、查询、状态、超时、用量和产物的公共语义 | 单任务查询、批量查询、动态查询、回调和供应商产物结构 |

### 0.3 合理推测

1. OpenHub 的正确核心不是“视频 API”，而是“多模态模型执行网关”；视频适合先验证最难的异步和 Schema 边界。
2. 大量 LLM、Embedding、图片和音频服务可能遵循相近的 OpenAI 风格，但不能在没有 fixture 的情况下宣称完全兼容。
3. 适配器 SDK 的价值是让新供应商遵守固定边界并拥有合规测试，不是让任意 JSON 自动获得执行能力。
4. `new-api-plugins` 证明“适配器代码 + manifest + 生命周期钩子”能覆盖真实供应商差异，但不证明单一通用参数 Schema 或远程插件执行适合 OpenHub。
5. 当前任务规模适合用“核心垂直切片 → 逐模态扩展 → 分批迁移适配器”的方式降低回退成本；一次性迁移五种模态会放大定位成本。

### 0.4 未验证假设

1. 未验证各供应商在同一模态内的协议重复度；必须由 fixture 和官方协议逐类验证。
2. 未验证未来调用方是否需要独立 npm client；先保证 HTTP API 稳定，再发布薄客户端。
3. 未验证所有供应商都提供模型发现或完整参数 Schema；缺少证据时必须进入待确认状态。
4. 未验证 MemeFast 是否会提供视频 API；在得到真实协议前不能扩展其视频能力。
5. 未验证 OpenHub 未来是否存在需要结果缓存、复杂限流或连接池的生产负载；本计划不先引入这些基础设施。

### 0.5 结论

原视频专用计划的范围不正确。可维护的目标应是：

1. **公共平台层：** 统一站点、密钥、模型、变体、路由、错误、审计和证据。
2. **模态契约层：** 分别描述 LLM、Embedding、图片、音频和视频的输入、输出与生命周期。
3. **适配器层：** 供应商差异由 manifest、协议模板或专用 SDK 适配器承载。
4. **应用接入层：** 外部网站或软件只调用 OpenHub，不实现供应商分支。

### 0.6 `new-api-plugins` 对本计划的直接影响

只吸收以下可迁移机制：

1. **Manifest：** 适配器身份、版本、模型绑定、能力、执行策略、用量和产物声明。
2. **生命周期钩子：** 解码输入、构造提交请求、解析任务 ID、查询任务、映射状态、读取结果、读取产物和提取用量。
3. **发布完整性：** 版本目录不可变、生成索引、SHA256、编译/合规 CI 和版本回滚。
4. **任务策略：** 把 `per_task`、`batch` 和供应商专属动态查询视为不同执行策略，而不是假设所有异步任务都能逐任务轮询。

明确不吸收：

1. 远程下载后动态执行 JS、`eval`、任意 import 或管理员上传即执行。
2. New API 的 `channelTypes`、内部路由命名和原生协议作为 OpenHub 数据库或公共 API 的强依赖。
3. 用模型列表或目录命中伪造参数 Schema；模型身份、能力和参数契约仍分别验真。

### 0.7 MemeFast Schema 问题的纠偏结论

#### 已确认事实

1. 当前系统已经能识别 MemeFast 模型的原始 ID、厂商和模态；截图中的 Seedance 模型身份与 `video` 模态并非主要问题。
2. 截图中的 `bytedance/seedance-2.0/mini/image-to-video` 只有候选 Schema 证据，不能证明 MemeFast 使用相同的参数、路径或任务生命周期。
3. 当前代码在候选 Schema 未确认时会清空 fal 参数、视频限制和 Schema 快照，这是安全策略，但不能把它解释为供应商执行能力不存在。
4. `provider_options`、`capabilityContract` 和 `videoContract` 已存在，可以承载本次修正，不需要新增远程插件执行器或新的基础设施。

#### 本次计划修正

OpenHub 必须明确维护三份互不覆盖的数据，同时让 fal.ai Schema 真正参与模板决策：

```text
模型身份与目录画像       -> 谁的模型、什么模态、外部参考信息
fal 参数模板             -> 统一字段、类型、默认值、枚举和限制
供应商执行契约           -> 请求怎么发、任务怎么查、结果怎么解析
```

最终判定规则：

- fal Schema 与模型身份、模态和操作高置信匹配，且适配器有明确的协议兼容和字段映射：自动应用为有效模板，参数进入表单、校验和请求映射。
- fal Schema 只有名称相似或协议映射不完整：保留为 `candidate`，不能自动应用。
- 有已验证适配器和可执行协议，但没有可应用的 fal Schema：可以执行已知基础请求，参数完整度为 `unknown/partial`。
- fal 模板与供应商适配器冲突：阻止该模板应用，保留冲突证据；请求仍只能按适配器已确认的契约构造。
- 适配器无法证明模型所属协议族或必要的提交/查询路径：不能猜测，状态为 `needs_review`。

因此，fal.ai 不是摆设，也不是直接请求执行器，而是 OpenHub 的**参数模板决策源**；适配器是模板落地到不同供应商的执行层。

本次不追求“自动识别所有供应商全部私有参数”；目标是让可证明兼容的 fal 模板真正生效，让未知参数可见，让错误映射不生效。

---

## 1. 产品定位与验收口径

### 1.1 P0 交付物

- 稳定的多模态 HTTP API：
  - `POST /v1/chat/completions`，支持非流式和流式。
  - `POST /v1/embeddings`。
  - `POST /v1/images/generations`、编辑和变体接口。
  - `POST /v1/audio/speech`、转写接口。
  - `POST /v1/video/generations`、任务查询和任务列表接口。
- 统一的适配器 manifest：ID、版本、支持模态、能力、配置 Schema 和证据。
- manifest 还必须声明模型绑定、入站协议能力、异步执行策略、用量 Schema、产物类型、鉴权方式和可选 Host allowlist。
- 适配器生命周期钩子：输入解码、提交请求构造、提交响应解析、查询请求构造、状态/结果解析、产物读取和用量提取。
- 生成的适配器索引：展示已注册版本、SHA256 和证据；索引与源码或 manifest 不一致时禁止注册。
- 分模态的公共契约：不把不适用的字段强行塞进所有请求。
- 统一的适配器注册与能力校验：注册时拒绝“声明有能力但没有实现”的适配器。
- 受信任的常见协议模板，以及对特殊供应商的 SDK 边界。
- 模型能力、参数契约、适配器和证据状态的明确展示。
- 多模态合规测试：LLM、Embedding、图片、音频和视频各有代表性 fixture。

### 1.2 P1 交付物

- `@openhub/client` 薄客户端，覆盖五类模态，只封装 OpenHub API。
- `@openhub/adapter-sdk` 的测试工具、模板和适配器接入文档。
- 异步任务扩展：接口预留 `per_task`、`batch` 和动态查询边界；首版先实现 `per_task`，有真实 fixture 后再启用批量/动态查询。
- 适配器版本升级、SHA256 校验、生成索引和回滚说明；不提供远程插件市场。
- CI 中固定 Node 22、全量测试、类型检查、前端构建和适配器合规测试。
- 供应商支持矩阵，区分已支持、需复核、需专用适配器和不支持。

### 1.3 明确非目标

- 不承诺所有供应商完全零代码接入。
- 不用模型名称、Fal 目录或 models.dev 记录伪造任何模态的可执行参数。
- 不把 LLM 的 `messages`、图片的 `size`、音频的 `voice` 和视频的 `duration` 强行做成同一种参数结构。
- 不让管理员在网页中填写任意 HTTP 方法、路径和响应选择器后立即获得执行能力。
- 不把 `new-api-plugins` 的单文件 JS 直接作为 OpenHub 运行时插件；OpenHub 首版只运行源码中已注册的 TypeScript 适配器和模板。
- 不把 `new-api-plugins` 的 `channelTypes` 或供应商原生协议暴露为 OpenHub 的稳定公共 API；需要兼容时必须建立明确的入站协议绑定。
- 不在本计划内实现 MemeFast 视频能力、供应商计费、跨实例队列或媒体永久存储。

### 1.4 终态验收场景

```text
外部网站或软件
  -> OpenHub 统一多模态 API
  -> 解析 model / variant
  -> 校验模态契约和参数限制
  -> 解析受信任适配器
  -> 调用供应商
  -> 统一响应、流、二进制或异步任务
  -> 外部网站或软件展示结果
```

必须同时证明：

- 上层应用不包含供应商名称分支。
- 同一模态的不同供应商可以通过不同适配器返回同一公共结果语义。
- 供应商私有参数不会被静默删除或误当作公共能力。
- 明确模型 ID 或别名可以显示为“身份已识别”；没有供应商执行契约时才显示“契约未确认”并阻断执行，只有目录参数缺失时显示参数完整度 `unknown/partial`。
- 适配器版本、源码摘要和模型绑定可追溯；索引篡改、哈希不匹配或版本冲突会阻止启用。
- LLM 流式事件、Embedding 向量、图片结果、音频二进制和视频异步任务都能独立验收。
- 未确认能力、缺少适配器、配置错误和参数错误均在调用前或明确的上游错误阶段暴露。
- 日志、任务查询和错误响应不泄露 API Key、原始提示词、媒体 URL 或完整敏感上游响应。

---

## 2. 文件地图

### 新增

- Create: `.node-version` — 固定本地和 CI 的 Node 22 主版本。
- Create: `packages/adapter-sdk/package.json` — 发布无服务端运行时依赖的多模态适配器 SDK。
- Create: `packages/adapter-sdk/src/common.ts` — 模态、能力、上下文、错误和证据类型。
- Create: `packages/adapter-sdk/src/llm.ts` — LLM 请求、响应、流式事件和适配器接口。
- Create: `packages/adapter-sdk/src/embedding.ts` — Embedding 请求、向量结果和适配器接口。
- Create: `packages/adapter-sdk/src/image.ts` — 图片生成、编辑、变体和结果类型。
- Create: `packages/adapter-sdk/src/audio.ts` — TTS、STT、二进制和文本结果类型。
- Create: `packages/adapter-sdk/src/video.ts` — 视频提交、查询、状态和结果类型。
- Create: `packages/adapter-sdk/src/lifecycle.ts` — 提交、查询、批量查询、状态、产物和用量钩子类型。
- Create: `packages/adapter-sdk/src/model-binding.ts` — 精确 ID、规范化 ID、别名和受审查前缀绑定类型。
- Create: `packages/adapter-sdk/src/manifest.ts` — manifest、协议能力、任务策略、配置 Schema、产物和证据引用类型。
- Create: `packages/adapter-sdk/src/conformance.ts` — 多模态适配器合规测试工具。
- Create: `packages/adapter-sdk/src/index.ts` — SDK 公共导出入口。
- Create: `packages/server/src/engine/adapter-manifest.ts` — manifest Zod 校验和版本处理。
- Create: `packages/server/src/engine/adapter-index.ts` — 生成/校验适配器版本索引和 SHA256。
- Create: `packages/server/scripts/adapter-index.ts` — 生成和检查适配器索引的 CLI 入口。
- Create: `packages/server/src/engine/adapters/templates/openai-compatible.ts` — 仅供代码内注册的 OpenAI 风格模板。
- Create: `packages/server/src/engine/adapters/templates/rest-json-task.ts` — 仅供代码内注册的 JSON 异步任务模板。
- Create: `packages/server/src/routes/admin/adapters.ts` — 管理端适配器 manifest 查询和配置校验接口。
- Create: `packages/server/test-adapter-sdk.ts` — SDK 类型和边界测试。
- Create: `packages/server/test-adapter-registry.ts` — 注册、版本和能力不变量测试。
- Create: `packages/server/test-adapter-index.ts` — 索引派生、哈希和版本不可变测试。
- Create: `packages/server/test-modality-contracts.ts` — 五种模态的契约测试。
- Create: `packages/server/test-adapter-conformance.ts` — 多协议 fixture 合规测试。
- Create: `packages/server/test-adapter-security.ts` — SSRF、超时、重试、脱敏和敏感字段测试。
- Create: `packages/server/test-fixtures/adapters/` — 各模态的提交、响应、流和错误 fixture。
- Create: `packages/web/src/components/AdapterConfigForm.tsx` — 根据 manifest Schema 渲染受限配置表单。
- Create: `packages/client/package.json` — 外部软件使用的 OpenHub 薄客户端。
- Create: `packages/client/src/index.ts` — 多模态 `OpenHubClient`。
- Create: `packages/client/test/client.test.ts` — 薄客户端请求和错误测试。
- Create: `docs/ADAPTER-SDK.md` — 适配器开发者文档。
- Create: `docs/MULTIMODAL-INTEGRATION.md` — 外部网站或软件接入文档。
- Create: `docs/MULTIMODAL-PROVIDER-EVIDENCE.md` — 供应商协议、Schema、fixture 和验证记录。

### 修改

- Modify: `package.json` — Node engines、workspace 验证命令和包脚本。
- Modify: `packages/server/package.json` — 依赖 SDK、索引生成/校验、各模态测试和适配器合规命令。
- Modify: `packages/server/src/engine/adapter.ts` — 与 SDK 类型兼容，保留旧模态接口的迁移层。
- Modify: `packages/server/src/engine/index.ts` — 注册内置适配器和 manifest。
- Modify: `packages/server/src/engine/discover.ts` — 分离运行时事实、目录建议、模态分类和执行证据。
- Modify: `packages/server/src/engine/model-profile.ts` — 统一生成分模态模型能力档案。
- Modify: `packages/server/src/engine/param-mapper.ts` — 按模态契约和显式供应商扩展区映射参数。
- Modify: `packages/server/src/engine/tasks/worker.ts` — 按 manifest 任务策略执行逐任务轮询，并为批量查询保留明确扩展边界。
- Modify: `packages/server/src/lib/model-contract.ts` — 支持五种模态的契约读取和运行时校验。
- Modify: `packages/server/src/routes/v1/chat.ts` — 接入统一能力和错误门禁。
- Modify: `packages/server/src/routes/v1/embeddings.ts` — 接入批量输入、向量结果和能力门禁。
- Modify: `packages/server/src/routes/v1/images.ts` — 接入生成、编辑、变体和结果格式门禁。
- Modify: `packages/server/src/routes/v1/audio.ts` — 接入 TTS、STT、二进制响应和错误脱敏。
- Modify: `packages/server/src/routes/v1/video.ts` — 接入视频契约、异步任务和统一错误。
- Modify: `packages/server/src/routes/admin.ts` — 挂载适配器 manifest 路由。
- Modify: `packages/server/src/routes/admin/sites.ts` — 校验站点适配器和站点配置。
- Modify: `packages/server/src/routes/admin/variants.ts` — 按模态校验变体和适配器能力。
- Modify: `packages/server/src/db/schema/models.ts` — 保存通用契约、适配器版本和验证状态，保留旧字段兼容性。
- Modify: `packages/server/src/db/schema/variants.ts` — 保存适配器配置验证状态。
- Generate: `packages/server/drizzle/` — 生成新增字段迁移。
- Modify: `packages/web/src/lib/api.ts` — 适配器、模型契约和配置校验 API。
- Modify: `packages/web/src/pages/Sites.tsx` — 站点适配器和连接状态。
- Modify: `packages/web/src/pages/Models.tsx` — 五种模态、证据和可执行状态。
- Modify: `packages/web/src/pages/Variants.tsx` — 公共参数、供应商参数和契约状态。
- Modify: `packages/web/src/pages/Wizard.tsx` — 多模态站点接入向导。
- Modify: `README.md` — 更新多模态产品定位和集成方式。

---

## 3. 任务分解

### Task 1: 固定运行时与可复现验证基线

**Files:**
- Create: `.node-version`
- Modify: `package.json`
- Modify: `packages/server/package.json`
- Modify: `README.md`

**Interfaces:**
- Produces: Node 22 验证入口和统一测试命令；不改变业务 API。

- [ ] **Step 1: 固定运行时**

  `.node-version` 固定为 `22`，根 `package.json` 增加：

  ```json
  "engines": {
    "node": ">=22 <23",
    "pnpm": ">=9 <11"
  }
  ```

- [ ] **Step 2: 固定现有基线命令**

  ```text
  pnpm typecheck
  pnpm test
  pnpm --filter @openhub/web build
  ```

- [ ] **Step 3: 验证基线**

  使用 Node 22 运行服务端测试、类型检查和前端构建；Node 24 只记录为不受支持环境，不通过业务代码绕过原生模块 ABI 错误。

  Expected: 现有测试全部通过，后续任务可以复现相同结果。

### Task 2: 建立多模态 SDK 类型边界

**Files:**
- Create: `packages/adapter-sdk/package.json`
- Create: `packages/adapter-sdk/src/common.ts`
- Create: `packages/adapter-sdk/src/llm.ts`
- Create: `packages/adapter-sdk/src/embedding.ts`
- Create: `packages/adapter-sdk/src/image.ts`
- Create: `packages/adapter-sdk/src/audio.ts`
- Create: `packages/adapter-sdk/src/video.ts`
- Create: `packages/adapter-sdk/src/lifecycle.ts`
- Create: `packages/adapter-sdk/src/model-binding.ts`
- Create: `packages/adapter-sdk/src/manifest.ts`
- Create: `packages/adapter-sdk/src/index.ts`
- Modify: `packages/server/package.json`
- Modify: `packages/server/src/engine/adapter.ts`
- Create: `packages/server/test-adapter-sdk.ts`

**Interfaces:**
- Produces: `@openhub/adapter-sdk` 的 `ProviderAdapter`、`AdapterManifest`、`AdapterContext` 和五种模态的请求/响应类型。

  ```ts
  export type Modality = "llm" | "embedding" | "image" | "audio" | "video";
  export type AdapterCapability =
    | "chat" | "chat.stream" | "embedding"
    | "image.generation" | "image.edit" | "image.variation"
    | "audio.speech" | "audio.transcription"
    | "video.submit" | "video.query" | "video.cancel";

  export interface ConfigSchema {
    type: "object";
    properties: Record<string, {
      type: "string" | "number" | "integer" | "boolean" | "enum";
      required?: boolean;
      enum?: string[];
      default?: unknown;
      secret?: boolean;
    }>;
  }

  export interface EvidenceRef {
    kind: "official-doc" | "fixture" | "runtime" | "admin-confirmed";
    ref: string;
    verifiedAt: string;
  }

  export interface DiscoveredModel {
    id: string;
    name?: string;
    ownedBy?: string;
    metadata?: Record<string, unknown>;
  }

  export interface AdapterContext {
    targetUrl: string;
    apiKey: string;
    config?: Record<string, unknown>;
    signal?: AbortSignal;
  }

  export interface AdapterBase {
    manifest: AdapterManifest;
    healthCheck(context: AdapterContext): Promise<boolean>;
    discoverModels?(context: AdapterContext): Promise<DiscoveredModel[]>;
  }

  export type AdapterHandler =
    | { modality: "llm"; handler: LlmAdapter }
    | { modality: "embedding"; handler: EmbeddingAdapter }
    | { modality: "image"; handler: ImageAdapter }
    | { modality: "audio"; handler: AudioAdapter }
    | { modality: "video"; handler: VideoAdapter }
    | { modality: "async-task"; handler: AsyncTaskAdapter | BatchTaskAdapter | DynamicTaskAdapter };

  export interface ProviderAdapter extends AdapterBase {
    handlers: readonly AdapterHandler[];
  }

  export interface LlmAdapter {
    complete(input: ChatRequest, context: AdapterContext): Promise<ChatResponse>;
    stream(input: ChatRequest, context: AdapterContext): Promise<Response>;
  }

  export interface EmbeddingAdapter {
    create(input: EmbeddingRequest, context: AdapterContext): Promise<EmbeddingResponse>;
  }

  export interface ImageAdapter {
    generate(input: ImageGenerationRequest, context: AdapterContext): Promise<ImageResponse>;
    edit?(input: ImageEditRequest, context: AdapterContext): Promise<ImageResponse>;
    variation?(input: ImageVariationRequest, context: AdapterContext): Promise<ImageResponse>;
  }

  export interface AudioAdapter {
    speech(input: AudioSpeechRequest, context: AdapterContext): Promise<ArrayBuffer>;
    transcribe(input: AudioTranscriptionRequest, context: AdapterContext): Promise<AudioTranscriptionResponse>;
  }

  export interface VideoAdapter {
    submit(input: VideoSubmitRequest, context: AdapterContext): Promise<VideoSubmitResult>;
    query(siteTaskId: string, context: AdapterContext): Promise<VideoQueryResult>;
    listArtifacts?(task: VideoQueryResult): ArtifactRef[];
    getArtifact?(artifact: ArtifactRef, context: AdapterContext): Promise<Response | ArrayBuffer>;
    extractUsage?(task: VideoQueryResult): UsageFacts | null;
  }

  export interface TaskSubmitResult {
    siteTaskId: string;
    initialStatus: "pending" | "processing";
    rawResult?: unknown;
  }

  export interface TaskQueryResult {
    status: "pending" | "processing" | "completed" | "failed" | "timeout";
    result?: unknown;
    error?: string;
    raw?: unknown;
  }

  export type TaskQueryMode = "per_task" | "batch" | "dynamic";

  export interface ArtifactRef {
    key: string;
    type: "image" | "audio" | "video" | "file";
    url?: string;
    expiresAt?: string;
  }

  export interface UsageFacts {
    [key: string]: string | number | boolean | null;
  }

  export interface TaskAdapterBase {
    submit(input: unknown, context: AdapterContext): Promise<TaskSubmitResult>;
    listArtifacts?(task: TaskQueryResult): ArtifactRef[];
    getArtifact?(artifact: ArtifactRef, context: AdapterContext): Promise<Response | ArrayBuffer>;
    extractUsage?(task: TaskQueryResult): UsageFacts | null;
  }

  export interface AsyncTaskAdapter extends TaskAdapterBase {
    queryMode: "per_task";
    query(taskId: string, context: AdapterContext): Promise<TaskQueryResult>;
  }

  export interface BatchTaskAdapter extends TaskAdapterBase {
    queryMode: "batch";
    queryMany(taskIds: string[], context: AdapterContext): Promise<TaskQueryResult[]>;
  }

  export interface DynamicTaskAdapter extends TaskAdapterBase {
    queryMode: "dynamic";
    dynamicQuery(input: unknown, context: AdapterContext): Promise<TaskQueryResult[]>;
  }
  ```

- Consumes: 当前 `packages/server/src/engine/adapter.ts` 中已经存在的模态请求和响应语义。

- [ ] **Step 1: 定义共享类型**

  共享类型只包含模态、能力、上下文、错误、证据和发现模型，不加入 Hono、Drizzle 或数据库类型。

- [ ] **Step 2: 定义模态专属接口**

  每个接口明确其生命周期：LLM 支持非流式和流式，Embedding 支持批量输入，图片区分生成/编辑/变体，音频区分 TTS/STT，视频区分提交/查询。模态接口不继承服务端基类；公共能力由 `AdapterBase` 提供，具体能力通过 `AdapterHandler` 组合。

- [ ] **Step 3: 定义异步生命周期和模型绑定接口**

  `lifecycle.ts` 必须把 `submit`、逐任务 `query`、状态映射、结果解析、产物列表、产物读取和用量提取作为独立钩子；P0 的 `AsyncTaskAdapter` 只实现 `per_task`。`BatchTaskAdapter` 和 `DynamicTaskAdapter` 是 P1 独立扩展，不把批量/动态字段塞进所有适配器。`model-binding.ts` 只允许源码声明的 `exact`、`normalized`、`alias` 和受审查 `prefix` 规则，不允许管理员提交正则或脚本。

- [ ] **Step 4: 增加兼容迁移层**

  服务端继续保留当前 `Adapter` 的导出，增加 `wrapLegacyAdapter(adapter): ProviderAdapter`，将旧的直接方法映射为 `AdapterHandler`；不在此任务一次性重写所有内置适配器。

- [ ] **Step 5: 编写边界测试**

  测试拒绝缺失必需方法、未知模态、能力与方法不一致、空适配器 ID、不完整视频生命周期、P1 扩展声明却没有对应实现和未经允许的模型匹配规则。

- [ ] **Step 6: 运行测试**

  ```text
  pnpm --filter @openhub/server exec tsx --test test-adapter-sdk.ts
  ```

  Expected: 新增测试通过，现有五种模态测试不受影响。

### Task 3: 建立 manifest、注册表和能力不变量

**Files:**
- Create: `packages/server/src/engine/adapter-manifest.ts`
- Create: `packages/server/src/engine/adapter-index.ts`
- Create: `packages/server/scripts/adapter-index.ts`
- Modify: `packages/server/src/engine/adapter.ts`
- Modify: `packages/server/src/engine/index.ts`
- Modify: `packages/server/package.json`
- Create: `packages/server/src/routes/admin/adapters.ts`
- Modify: `packages/server/src/routes/admin.ts`
- Create: `packages/server/test-adapter-registry.ts`
- Create: `packages/server/test-adapter-index.ts`

**Interfaces:**
- Produces: `registerAdapter()`、`getAdapter()`、`listAdapters()`、`listAdapterManifests()`、`getAdapterManifest()`、`validateAdapterConfig()` 和 `validateAdapterIndex()`。
- Consumes: `@openhub/adapter-sdk` 的 `ProviderAdapter` 和 `AdapterManifest`。

- [ ] **Step 1: 定义 manifest**

  manifest 必须包含：

  ```ts
  interface AdapterManifest {
    id: string;
    version: string;
    displayName: string;
    description?: { zh?: string; en?: string };
    modalities: Modality[];
    capabilities: AdapterCapability[];
    modelBindings: Array<{
      match: "exact" | "normalized" | "alias" | "prefix";
      values: string[];
      vendor?: string;
      evidence: EvidenceRef[];
    }>;
    protocolBindings: Array<"openhub" | "openai-compatible">;
    taskStrategy?: { queryMode: "per_task" | "batch" | "dynamic" };
    usageSchema?: Record<string, { type: "number" | "string" | "boolean"; unit?: string }>;
    artifactTypes?: Array<"image" | "audio" | "video" | "file">;
    configSchema: ConfigSchema;
    auth: "api_key" | "oauth2_jwt" | "none";
    allowedHosts?: string[];
    evidence: EvidenceRef[];
  }
  ```

- [ ] **Step 2: 在启动时校验注册**

  启动时逐个校验内置适配器并记录 `ready` 或 `invalid/quarantined`；非法适配器不进入可执行注册表，但继续显示在管理诊断中。只有所有适配器都无效时，服务才阻止进入可调用状态。校验必须拒绝：重复 canonical ID、非法版本、声明能力但没有实现、声明视频但缺少提交或查询、模型绑定规则为空或没有证据、重复模型绑定和不受支持的入站协议。P0 只把 `per_task` 作为可执行任务策略；声明 `batch` 或 `dynamic` 的适配器进入 `extension_required/quarantined`，启用对应 P1 扩展时再要求 `queryMany` 或 `dynamicQuery` 实现。`channelTypes` 等 New API 内部字段不进入 OpenHub manifest。

- [ ] **Step 3: 生成并校验适配器索引**

  `packages/server/scripts/adapter-index.ts generate` 从已注册 manifest 和构建产物生成派生索引，至少包含 `id`、`version`、显示信息、模型绑定摘要、能力、artifact 类型和构建产物 SHA256；`check` 重新生成并比较索引。索引不允许手工成为运行时事实；启动或安装时必须重新加载源码/构建产物、校验 SHA256、解析 manifest 并检查 `id/version` 一致性。已发布版本目录不可原地修改，只能发布新版本。

- [ ] **Step 4: 增加管理查询接口**

  `GET /admin/adapters` 只返回 manifest、能力、模型绑定、任务策略、版本、SHA256、配置字段和证据摘要，不返回 API Key、适配器上下文、原始请求或上游响应。

- [ ] **Step 5: 测试注册表和索引**

  Expected: 当前内置适配器全部能注册和列出；非法适配器、能力/实现不一致、模型绑定冲突、哈希不匹配和版本目录漂移在启动或安装阶段失败；管理接口不泄露密钥。

### Task 4: 建立五种模态的来源中立契约

**Files:**
- Modify: `packages/server/src/db/schema/models.ts`
- Modify: `packages/server/src/db/schema/variants.ts`
- Generate: `packages/server/drizzle/`
- Modify: `packages/server/src/lib/model-contract.ts`
- Modify: `packages/server/src/engine/param-mapper.ts`
- Modify: `packages/server/src/engine/discover.ts`
- Create: `packages/server/test-modality-contracts.ts`

**Interfaces:**
- Produces: 统一的 `CapabilityContract`、契约证据状态和模态参数校验入口。
- Consumes: 运行时元数据、供应商 Schema、适配器 manifest、目录建议、现有 Fal 快照和人工确认。

  ```ts
  interface CapabilityContract {
    modality: Modality;
    version: string;
    input: ContractNode;
    output: ContractNode;
    lifecycle: "sync" | "stream" | "async" | "binary";
    source: "provider" | "adapter" | "runtime" | "catalog" | "admin";
    status: "confirmed" | "candidate" | "partial" | "unverified";
    identityStatus: "recognized" | "ambiguous" | "unmatched";
    identitySource: "adapter-manifest" | "runtime" | "catalog" | "name" | "admin";
    parameterCoverage: "complete" | "partial" | "unknown";
    executionStatus: "ready" | "needs_review" | "unavailable";
    reason: string;
  }

  type ContractNode = {
    type: "string" | "number" | "integer" | "boolean" | "object" | "array" | "media";
    required?: boolean;
    enum?: Array<string | number | boolean>;
    minimum?: number;
    maximum?: number;
    minItems?: number;
    maxItems?: number;
    properties?: Record<string, ContractNode>;
    items?: ContractNode;
    dependsOn?: Array<{ field: string; equals: string | number | boolean }>;
  };
  ```

- [ ] **Step 1: 增加通用契约和身份状态存储**

  在 `models` 增加可空字段 `capabilityContractSnapshot`、`capabilityContractSource`、`capabilityContractStatus`、`capabilityContractReason`、`capabilityContractSyncedAt`、`modelIdentityStatus`、`modelIdentitySource`、`modelIdentityReason`、`adapterVersion`、`adapterHash`、`adapterValidationStatus` 和 `adapterValidationReason`。模型名称被 manifest 精确/规范化/别名绑定命中时，可以确认身份；不能由此自动确认参数。

- [ ] **Step 2: 增加变体配置状态**

  在 `variants` 增加 `adapterConfigStatus`、`adapterConfigReason` 和 `adapterConfigValidatedAt`；旧 `adapterConfig` 继续可读，迁移只增加字段，不破坏旧记录。

- [ ] **Step 3: 固定证据优先级**

  ```text
  模型身份：
    适配器 manifest 的 exact/normalized/alias 绑定
      > 供应商运行时模型列表
      > 高置信目录匹配
      > 名称规则

  参数契约：
    人工确认的供应商契约
      > 已验证适配器 manifest + fixture
      > 供应商运行时 Schema
      > 高置信目录匹配
      > 模型名称推断
  ```

  `identityStatus=recognized` 不等于 `status=confirmed`；名称和模型列表可以解决“它是谁”，不能单独解决“它支持哪些参数”。目录不能覆盖供应商已确认的契约。`executionStatus` 由身份、契约、适配器注册状态、配置状态和必需能力派生，UI 只展示三级状态；底层证据状态继续保留用于诊断和门禁。

- [ ] **Step 4: 实现分模态校验**

  契约节点必须支持字符串、数字、布尔、枚举、对象、数组、必填、默认值、数值范围、数组数量、媒体类型和字段依赖；LLM、Embedding、图片、音频和视频分别定义允许的生命周期。

- [ ] **Step 5: 禁止静默丢参**

  ```text
  公共字段 -> 对应模态契约校验和映射
  provider_options -> 当前适配器 allowlist 校验后转发
  未知字段 -> 返回 model_parameter_invalid，不发送上游
  ```

- [ ] **Step 6: 测试契约状态**

  Expected: 五种模态的非法类型、非法枚举、缺少必填、未确认契约和未知参数都能在上游调用前失败；模型名被可靠识别但参数证据不足时显示“身份已识别/契约未确认”，不伪造参数；旧 Fal 数据仍能读取但不能覆盖已确认供应商契约。

### Task 5: 建立受信任协议模板并迁移内置适配器

**Files:**
- Create: `packages/server/src/engine/adapters/templates/openai-compatible.ts`
- Create: `packages/server/src/engine/adapters/templates/rest-json-task.ts`
- Modify: `packages/server/src/engine/adapters/openai.ts`
- Modify: `packages/server/src/engine/adapters/kling.ts`
- Modify: `packages/server/src/engine/adapters/wan.ts`
- Modify: `packages/server/src/engine/adapters/seedance.ts`
- Modify: `packages/server/src/engine/adapters/grok.ts`
- Modify: `packages/server/src/engine/adapters/memefast.ts`
- Create: `packages/server/test-adapter-conformance.ts`
- Create: `packages/server/test-fixtures/adapters/`

**Interfaces:**
- Produces: 受信任的 `OpenAICompatibleDefinition`、`JsonTaskAdapterDefinition` 和异步生命周期钩子；路径、响应读取、状态映射、鉴权策略和模型绑定来自源码，不来自数据库或远程索引。

  ```ts
  interface JsonTaskAdapterDefinition {
    id: string;
    modalities: Modality[];
    queryMode: "per_task";
    submitPath: string;
    queryPath: string;
    buildRequest(input: unknown): Record<string, unknown>;
    readTaskId(body: unknown): string | null;
    readStatus(body: unknown): unknown;
    readResult(body: unknown): unknown;
    listArtifacts?(result: unknown): ArtifactRef[];
    extractUsage?(request: unknown, result: unknown): UsageFacts | null;
  }

  interface BatchJsonTaskAdapterDefinition {
    queryMode: "batch";
    buildBatchQueryRequest(taskIds: string[]): { method: "POST"; path: string; body: unknown };
    readBatchResults(body: unknown): unknown[];
  }

  interface DynamicJsonTaskAdapterDefinition {
    queryMode: "dynamic";
    buildDynamicQueryRequest(input: unknown): { method: "POST" | "GET"; path: string; body?: unknown };
    readDynamicResults(body: unknown): unknown[];
  }
  ```

- [ ] **Step 1: 为每种模态准备 fixture**

  至少准备：LLM 非流式和流式、Embedding 批量、图片 URL 与 Base64、音频二进制与文本、视频提交与查询成功/失败、带多个产物的任务和 `per_task` 任务 fixture；`batch`/动态查询 fixture 只在 P1 扩展立项时加入，fixture 只记录协议事实，不复制外部插件运行时。

- [ ] **Step 2: 实现 OpenAI 风格模板**

  模板只处理已确认的 OpenAI 风格路径和字段；不因为供应商声称“兼容”就自动开启所有图片、音频或视频能力。

- [ ] **Step 3: 建立旧适配器兼容桥并完成首个垂直切片**

  先用 `wrapLegacyAdapter()` 接入一个现有 OpenAI 风格适配器和一个现有 `per_task` 异步适配器，完成非流式、流式和异步提交/查询的端到端 fixture 测试；其余适配器暂时保持旧接口，不允许一次性迁移全部实现。

- [ ] **Step 4: 实现 JSON 异步任务模板**

  P0 模板只允许代码内定义的 `POST` 提交和 `GET` 查询，支持固定的状态和结果读取函数、产物和用量钩子；只接受 `per_task`。P1 的批量/动态模板必须使用独立定义和独立合规测试；任何模式都不读取数据库中的 HTTP 方法、任意路径或任意响应选择器。

- [ ] **Step 5: 处理协议绑定而非复制供应商协议**

  将 `new-api-plugins` 中“标准入口 + 供应商原生入口”的差异映射为 OpenHub 的显式入站协议绑定；OpenHub 公共 API 只暴露稳定的 `openhub`/受控 `openai-compatible` 入口，供应商原生路径仅由适配器内部使用，不自动暴露给调用方。

- [ ] **Step 6: 保留特殊适配器代码**

  表单请求、特殊鉴权、multipart、媒体上传、供应商对象存储、回调或不规则状态机继续使用专用适配器，不为了复用强行压平。

- [ ] **Step 7: 按适配器分批迁移**

  每迁移一个适配器，只修改该适配器和对应 fixture；通过请求构造、响应解析、错误、模型绑定和回退测试后再迁移下一个。迁移失败时继续由兼容桥运行，不阻断其他适配器。

- [ ] **Step 8: 清理旧配置风险**

  现有 `adapterConfig` 中的 `submitPath`、`queryPath`、HTTP 方法和响应选择器只允许迁移为已知默认值；之后忽略用户对这些字段的覆盖。站点 `baseUrl` 继续经过 SSRF 校验。

- [x] **Step 9: 接入 MemeFast 已验证视频协议族**

  MemeFast 视频适配器按模型家族选择已验证协议，支持 VEO、OpenAI/Grok、Seedance、Kling、Vidu、Pixverse、MiniMax 和 Luma 的提交/查询；无法证明协议的模型保持失败关闭，不猜测路径。

- [ ] **Step 10: 运行多模态合规测试**

  Expected: 代表性适配器都能通过对应模态的请求、响应、错误和生命周期测试；未声明的能力调用得到 `capability_unsupported`。

### Task 6: 统一路由、执行和错误门禁

**Files:**
- Modify: `packages/server/src/routes/v1/chat.ts`
- Modify: `packages/server/src/routes/v1/embeddings.ts`
- Modify: `packages/server/src/routes/v1/images.ts`
- Modify: `packages/server/src/routes/v1/audio.ts`
- Modify: `packages/server/src/routes/v1/video.ts`
- Modify: `packages/server/src/engine/tasks/worker.ts`
- Modify: `packages/server/src/lib/model-contract.ts`
- Create: `packages/server/test-modality-routing.ts`

**Interfaces:**
- Produces: 五种模态一致的路由错误、能力门禁、脱敏策略和任务/流/二进制结果行为；模型身份状态与参数契约状态分离。
- Consumes: 已验证的模型契约、变体配置和适配器 manifest。

- [ ] **Step 1: 统一适配器解析**

  所有模态都按 `model.adapterId` 和兼容的站点配置解析适配器；管理员手动覆盖优先于自动建议，但必须通过注册表和能力校验。模型解析先使用 manifest 的模型绑定确定身份，再使用契约状态决定是否可执行。

- [ ] **Step 2: 固定错误码**

  五种模态共用：`adapter_not_found`、`adapter_config_invalid`、`capability_unsupported`、`contract_unconfirmed`、`extension_required`、`model_parameter_invalid`、`upstream_error`、`upstream_timeout`。

- [ ] **Step 3: 分别保持生命周期**

  LLM 保留 SSE 流，Embedding 返回向量数组，图片返回 URL/Base64，音频返回正确 Content-Type 的二进制或转写 JSON，视频继续走任务表、worker、查询和回调。

- [ ] **Step 4: 按任务策略执行异步查询**

  P0 只执行 `per_task` 任务并沿用当前逐任务查询；`batch` 和 `dynamic` 在未启用扩展时返回 `extension_required`，不被误当作可调用。P1 批量任务按站点、适配器和查询端点分组后调用 `queryMany`；动态查询只能由明确声明的专用适配器处理，不创建任意动态 URL 执行器。

- [ ] **Step 5: 保持可控并发和无缓存默认**

  P0 沿用当前 worker 的串行批处理作为安全并发上限，保留超时、轮询次数和延迟指标；不引入新的限流库、连接池或结果缓存。只有运行指标证明瓶颈后，才单独立项增加站点级限流或并发控制。

- [ ] **Step 6: 处理重试边界**

  GET 查询允许有限重试；POST 创建只有存在幂等键时才允许重试；流式和音频二进制响应不进行可能导致重复计费的自动重试。

- [ ] **Step 7: 编写路由测试**

  Expected: 每种模态都能验证成功、身份已识别但契约未确认、未知能力、错误参数、适配器缺失、未启用扩展策略、逐任务策略、上游超时和敏感信息脱敏。

### Task 7: 改造多模态站点接入向导和管理界面

**Files:**
- Create: `packages/server/src/routes/admin/adapters.ts`
- Modify: `packages/server/src/routes/admin/sites.ts`
- Modify: `packages/server/src/routes/admin/variants.ts`
- Modify: `packages/server/src/routes/admin/wizard.ts`
- Modify: `packages/web/src/lib/api.ts`
- Create: `packages/web/src/components/AdapterConfigForm.tsx`
- Modify: `packages/web/src/pages/Sites.tsx`
- Modify: `packages/web/src/pages/Models.tsx`
- Modify: `packages/web/src/pages/Variants.tsx`
- Modify: `packages/web/src/pages/Wizard.tsx`
- Create: `packages/server/test-admin-adapter-flow.ts`

**Interfaces:**
- Produces: 管理员可以选择适配器、看到五种模态能力、模型身份状态、契约状态、任务策略、版本和证据，并校验配置、发现模型和确认契约。

- [ ] **Step 1: 固定向导流程**

  ```text
  选择适配器 -> 输入站点地址和 Key -> 校验连接与配置
  -> 发现模型 -> 查看模态与证据 -> 确认契约
  -> 创建对应模态的变体
  ```

- [ ] **Step 2: 按 manifest 渲染配置**

  `AdapterConfigForm` 只渲染 manifest 允许的配置字段；不提供任意请求路径、方法或响应选择器输入框。

- [ ] **Step 3: 显示五种模态真实状态**

  分开显示：`身份已识别`、`参数契约已确认`、`需要确认`、`协议不支持`、`适配器缺失`、`连接失败`。模型名称或 manifest 模型列表命中只解决身份，不直接显示“正常”。

- [ ] **Step 4: 生成用户可理解的执行状态**

  前端根据后端派生的 `executionStatus` 只展示 `ready`、`needs_review`、`unavailable` 三级主状态，详情面板再展示身份、契约、适配器、配置和证据原因；不把 12 种底层组合直接暴露给用户。

- [ ] **Step 5: 显示版本和完整性状态**

  展示适配器 `id`、版本、SHA256、模型绑定来源、任务查询策略和证据摘要；索引漂移、版本冲突或哈希不匹配时禁止启用，不允许通过网页绕过。

- [ ] **Step 6: 修复异步保存状态**

  创建站点、发现模型、Schema 匹配和创建变体分别维护 loading/error 状态；失败后恢复按钮并显示后端错误码，不永久停留在“保存中”。

- [ ] **Step 7: 保持前端状态实现克制**

  P0 使用现有 React Query mutation 状态和页面级 `useState`/`useReducer`，不新增 Zustand、Jotai 或状态机依赖；只有出现跨页面状态同步的已验证需求时才单独评估。

- [ ] **Step 8: 测试管理流程**

  使用本地 mock 验证：LLM、Embedding、图片、音频和视频各创建一个变体；验证配置错误、契约待确认、能力不支持和发现失败都能被准确显示。

### Task 8: 提供外部软件多模态接入层

**Files:**
- Create: `packages/client/package.json`
- Create: `packages/client/src/index.ts`
- Create: `packages/client/test/client.test.ts`
- Create: `docs/MULTIMODAL-INTEGRATION.md`
- Modify: `README.md`

**Interfaces:**
- Produces: `OpenHubClient` 的聊天、Embedding、图片、音频和视频方法；客户端不直接接触供应商 Key。
- Consumes: OpenHub 的稳定 HTTP API。

  ```ts
  export type VideoTaskStatus = "pending" | "processing" | "completed" | "failed" | "timeout";
  export interface VideoTask { id: string; status: VideoTaskStatus; result?: unknown; error?: string | null; }
  export interface WaitOptions { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal; }

  export interface OpenHubClientOptions {
    baseUrl: string;
    apiKey: string;
    fetch?: typeof fetch;
  }

  export class OpenHubClient {
    constructor(options: OpenHubClientOptions);
    chat(input: ChatRequest): Promise<ChatResponse>;
    chatStream(input: ChatRequest): Promise<Response>;
    embeddings(input: EmbeddingRequest): Promise<EmbeddingResponse>;
    generateImage(input: ImageGenerationRequest): Promise<ImageResponse>;
    synthesizeSpeech(input: AudioSpeechRequest): Promise<ArrayBuffer>;
    transcribeAudio(input: AudioTranscriptionRequest): Promise<AudioTranscriptionResponse>;
    createVideo(input: VideoSubmitRequest): Promise<VideoTask>;
    getVideoTask(id: string): Promise<VideoTask>;
    waitForVideoTask(id: string, options?: WaitOptions): Promise<VideoTask>;
  }
  ```

- [ ] **Step 1: 先固定 HTTP 文档**

  文档明确五种模态的请求、响应、流、二进制、状态、错误、幂等键、回调和认证语义；说明调用方只需要 OpenHub Key，不需要供应商 Key。SDK 类型和服务端 Zod/路由校验是 P0 的事实来源，CI 检查文档引用的端点和必填字段；不在 P0 新增 TypeDoc 或 OpenAPI 生成依赖，API 稳定后再单独评估自动生成。

- [ ] **Step 2: 实现薄客户端**

  客户端只封装 HTTP、超时、错误码、统一任务轮询和产物读取；不包含供应商名称判断、供应商参数映射或供应商原生路径。

- [ ] **Step 3: 保护浏览器端使用方式**

  文档明确生产环境推荐由自有后端调用，避免把 OpenHub Key 放进公开浏览器代码；浏览器直连只作为开发场景。

- [ ] **Step 4: 测试客户端**

  使用本地 mock 验证五种模态的请求序列、流式响应、二进制响应、视频轮询、超时和结构化错误。

### Task 9: 建立多模态适配器合规、安全和证据系统

**Files:**
- Modify: `packages/adapter-sdk/src/conformance.ts`
- Modify: `packages/server/package.json`
- Create: `packages/server/test-adapter-security.ts`
- Modify: `packages/server/src/engine/tasks/worker.ts`
- Modify: `packages/server/src/lib/ssrf.ts`
- Modify: `packages/server/src/lib/log.ts`
- Create: `docs/ADAPTER-SDK.md`
- Create: `docs/MULTIMODAL-PROVIDER-EVIDENCE.md`

**Interfaces:**
- Produces: `runAdapterConformance(adapter, fixtures)` 和多模态接入报告。

  ```ts
  export interface AdapterFixture {
    name: string;
    modality: Modality;
    request: unknown;
    response: unknown;
    expectedErrorCode?: string;
    expectedResult?: unknown;
  }

  export interface AdapterConformanceReport {
    adapterId: string;
    passed: boolean;
    checks: Array<{
      modality: Modality;
      name: string;
      passed: boolean;
      message?: string;
    }>;
  }

  export function runAdapterConformance(
    adapter: ProviderAdapter,
    fixtures: AdapterFixture[],
  ): Promise<AdapterConformanceReport>;
  ```

- [ ] **Step 1: 固定各模态合规项**

  ```text
  LLM：非流式、流式、usage、工具/结构化字段的声明一致
  Embedding：单条、批量、向量维度和 usage
  Image：生成、编辑/变体声明、URL/Base64 和错误
  Audio：TTS Content-Type、STT 文本/字幕格式和错误
  Video：submit/query、状态映射、结果 URL、产物和超时
  异步策略：P0 的 `per_task` 声明与实现一致；`batch`/动态查询只有在 P1 扩展启用后才校验对应实现，否则必须进入 `extension_required/quarantined`
  Manifest：模型绑定、版本、协议、用量 Schema、产物类型和证据完整
  ```

  测试继续遵循当前 `packages/server/test-*.ts` 的扁平约定：纯逻辑测试不启动服务，路由/数据库测试使用本地 mock，供应商数据按适配器和模态放入 `test-fixtures`；不为形式上的分层搬迁现有测试。

- [ ] **Step 2: 加入供应链和网络安全门禁**

  站点地址继续使用现有 SSRF 校验；适配器路径来自源码；manifest 与源码版本、SHA256 和模型绑定一致；禁止 `eval`、`new Function`、远程 import 和远程 JS 自动执行；所有请求增加 AbortController 超时；GET 查询允许有限重试；可重复的 POST 只在幂等键存在时重试。`allowedHosts` 只能作为受审查的出站限制，不能替代源码和 manifest 校验。

- [ ] **Step 3: 执行敏感信息清理**

  对请求体、上游响应、错误、日志和 fixture 执行 API Key、提示词、媒体 URL、Authorization 和 Cookie 清理；任务查询只返回脱敏后的 meta。

- [ ] **Step 4: 建立证据台账**

  每个适配器和模态记录：协议来源、文档或 fixture、验证日期、支持能力、未支持能力、模型绑定、Schema 状态、参数限制、任务策略、产物类型、用量字段和已知失败条件。将 `new-api-plugins` 记录为设计参考证据，不把其代码或 `channelTypes` 作为运行时依赖。

- [ ] **Step 5: 校验生成索引和版本不可变**

  CI 必须重新生成适配器索引并比较工作树；检测到手工改索引、源码哈希不一致、同一版本内容变化或 manifest 与目录不一致时失败。升级通过新版本目录完成，旧版本仍可回滚。

- [ ] **Step 6: 注册适配器测试命令**

  在 `packages/server/package.json` 增加：

  ```json
  "adapter:index": "tsx scripts/adapter-index.ts generate",
  "adapter:index:check": "tsx scripts/adapter-index.ts check",
  "test:adapters": "tsx --test test-adapter-sdk.ts test-adapter-registry.ts test-adapter-index.ts test-modality-contracts.ts test-adapter-conformance.ts test-adapter-security.ts"
  ```

- [ ] **Step 7: 运行安全测试**

  Expected: 私网地址策略、Host 限制、超时、重试、错误脱敏、敏感字段扫描、索引完整性和五种模态合规测试全部通过；不存在任意 URL/路径执行入口或远程代码执行入口。

### Task 10: 用多模态试点完成发布验收

**Files:**
- Modify: `packages/server/test-fixtures/adapters/`
- Modify: `docs/MULTIMODAL-PROVIDER-EVIDENCE.md`
- Modify: `README.md`
- Modify: `COMPLETION_STATUS.md`

**Interfaces:**
- Produces: 五种模态的供应商支持矩阵和发布前验收报告。

- [ ] **Step 1: 选择代表性协议试点**

  至少覆盖：

  ```text
  一个兼容 OpenAI 风格的 LLM/Embedding/图片/音频供应商
  一个请求或结果结构不同、包含二进制或 multipart 的直连接口
  一个 per_task 异步视频或多模态内容接口
  一个 batch/dynamic 查询的异步任务接口（P1 扩展；没有真实供应商时至少验证明确拒绝路径）
  ```

  每个试点必须有官方文档或固定 fixture；没有证据的供应商不进入“已支持”列表。

- [ ] **Step 2: 验证同一上层应用流程**

  上层应用只调用 `OpenHubClient` 或稳定 HTTP API，不增加供应商分支；分别完成聊天、向量、图片、音频和视频调用。

- [ ] **Step 3: 验证失败边界**

  分别验证：模型未知、模态未知、契约未确认、参数非法、适配器缺失、供应商返回失败、流中断、二进制错误、视频查询超时和结果缺少媒体 URL。

- [ ] **Step 4: 运行完整验证**

  ```text
  pnpm --filter @openhub/server adapter:index:check
  pnpm typecheck
  pnpm test
  pnpm --filter @openhub/web build
  pnpm --filter @openhub/server test:adapters
  git diff --check
  ```

- [ ] **Step 5: 生成支持矩阵**

  每个供应商的每个模态同时记录 `identityStatus`、`contractStatus`、适配器版本、SHA256、模型绑定、任务策略、用量和产物状态；最终支持状态只允许：`supported`、`supported_with_review`、`adapter_required`、`unsupported`，不得使用模糊的“理论支持”。

---

### Task 11: 建立 fal 模板应用与供应商适配绑定

**目标：** 修复“fal Schema 只能显示、不能真正帮助调用”的根因。fal.ai Schema 作为 OpenHub 的参数模板决策源，负责决定统一参数模板是否可以应用；供应商适配器负责把已应用模板转换成目标站点真实请求。

**Files:**
- Modify: `packages/server/src/engine/discover.ts`
- Modify: `packages/server/src/lib/model-contract.ts`
- Modify: `packages/server/src/engine/catalog/schema-matcher.ts`
- Modify: `packages/server/src/engine/param-mapper.ts`
- Modify: `packages/server/src/routes/router.ts`
- Modify: `packages/server/src/routes/admin/models.ts`
- Modify: `packages/web/src/pages/Models.tsx`
- Modify: `packages/web/src/pages/Wizard.tsx`
- Create: `packages/server/test-provider-contract-separation.ts`

**执行顺序：**

- [ ] **Step 11.1：固定三层数据边界**

  保留并明确区分：模型身份/目录画像、fal 参数模板、供应商执行契约。`schemaMatchStatus=confirmed` 表示 fal 模板已经通过适用性检查并可应用；它不能直接替代供应商的请求路径、状态和结果解析。

- [ ] **Step 11.2：让适配器声明模板兼容性**

  在现有 manifest/适配器能力声明中补充最小模板绑定信息：支持的 fal Schema 模态/操作、模板字段到供应商字段的映射、创建/查询生命周期和证据来源。绑定按协议族和结构化能力匹配，不为单个模型堆硬编码别名。MemeFast 的模型只有在适配器能证明对应协议族和生命周期时，才允许应用模板。

- [ ] **Step 11.3：让 fal 模板参与决策并落地**

  `schema-matcher` 输出模板候选后，新增最小适用性判断：身份匹配、模态匹配、操作匹配、适配器兼容、字段映射完整、异步生命周期完整。全部满足时保存 fal 参数/输入 Schema 快照并标记 `confirmed/applied`；否则保留 `candidate` 和失败原因。应用模板只提供公共参数结构，不能覆盖 MemeFast 的请求路径、提交/查询流程、状态映射和结果解析。

- [ ] **Step 11.4：执行模板到供应商的字段映射**

  已应用 fal 模板的公共参数先经过 OpenHub 校验，再由适配器映射到供应商字段；供应商私有参数必须通过已声明的 `provider_options` 或扩展契约传递；没有对应映射的字段不得伪造、静默丢弃或发送到错误路径。有效参数按“模板默认值 → 变体覆盖 → 调用请求覆盖”合并，最终以适配器和供应商边界校验。

- [ ] **Step 11.5：修正状态和界面文案**

  将“执行状态”和“参数完整度”分开显示：

  ```text
  模板：已应用     = fal Schema 已通过适用性检查，可作为统一参数模板
  模板：候选       = fal Schema 有线索，但尚未证明能套用到目标站点
  执行：就绪       = 适配器、协议、字段映射、配置和必要生命周期已确认
  参数：部分/未知  = 模板或供应商没有提供完整参数资料
  ```

  不再因为 `Schema 未关联` 单独显示“不可用”；如果模板不能应用，必须显示具体原因是身份、模态、操作、适配器、字段映射、配置还是生命周期不匹配。

- [ ] **Step 11.6：增加最小回归测试**

  至少覆盖：

  1. fal Schema 与适配器兼容证据充分：模板状态为 `confirmed/applied`，参数进入表单和请求映射。
  2. 只有 fal 候选 Schema、没有适配器兼容证据：模板为 `candidate`，不得自动应用。
  3. 已应用模板的字段按 MemeFast 适配器映射，不直接把 fal 路径或 JSON 原样发送给 MemeFast。
  4. fal 模板缺失但适配器具备基础协议：可执行基础请求，参数完整度为 `unknown/partial`。
  5. 变体修改比例、分辨率、时长和参考媒体数量时，不会被模板默认值强制回退。
  6. `provider_options` 能按适配器声明传递，未知字段不会静默丢失。
  7. LLM、图片、音频、视频各至少验证一条同样的边界。

- [ ] **Step 11.7：本地验收**

  使用现有 MemeFast 站点模型数据，不执行真实付费生成，完成类型检查、服务端相关测试、适配器索引校验、前端构建和 `/admin/models` 页面验收。

- [ ] **Step 11.8：支持模板替换和参数覆盖**

  管理员可以在已注册且兼容的 fal 模板之间切换，也可以保存一个经过 Schema 校验、版本化的本地自定义模板；切换模板前必须重新执行模态、操作、字段映射和适配器兼容性检查。模板应用后，变体和调用方可以覆盖比例、分辨率、时长、参考媒体数量等可变参数；校验的是字段类型、供应商真实支持范围和参数组合，而不是强制恢复模板默认值。供应商私有字段只能通过适配器声明的 `provider_options` 使用。禁止自定义模板携带任意 URL、HTTP 方法、响应选择器或可执行脚本。

- [ ] **Step 11.9：定义变体覆盖边界**

  变体必须允许配置 `paramOverrides`、`paramLimits` 和 `fieldMapping`，并将其作为运行时有效参数的一部分。比例、分辨率、时长和参考媒体数量属于首批可覆盖字段；如果模板没有列出某个值但适配器明确支持，则允许使用；如果供应商边界已知且超出范围，才拒绝；如果边界未知但适配器允许透传，则保留为待验证并按适配器规则发送，不能擅自回退到模板默认值。拒绝时必须返回字段级原因。

**完成标准：**

- fal Schema 能在证据充分时真正生成并应用统一参数模板。
- MemeFast 适配器能把已应用模板转换为自己的请求、查询和结果协议。
- fal Schema 不能在证据不足时把错误的第三方参数自动套到 MemeFast。
- 管理员可以替换兼容模板或保存安全的自定义模板；模板切换不会改变原始模型 ID。
- 应用模板后，调用方可以按目标修改允许参数，适配器负责最终字段转换和供应商调用。
- 变体可以独立修改比例、分辨率、时长和参考媒体数量，不会被模板默认值强制回退。
- 模型可以同时显示“模板已应用”“执行就绪”和“参数资料部分完整”。
- 所有未知情况都有明确状态和原因，不再用空白参数制造误导。

## 4. 版本与发布策略

### 4.1 推荐拆分

不要把全部目标做成一个大 PR；十个 Task 是能力清单，不是一次性执行批次，按以下垂直验收闸门推进：

1. **闸门 A：架构证明。** 完成 Task 1、Task 2 的公共/LLM 类型、Task 3 的 manifest/注册校验、Task 5 的兼容桥和一个 `per_task` 适配器、Task 6 的 LLM 非流式/流式与异步提交/查询；先证明路由、契约、适配器和任务状态能闭环。
2. **闸门 B：模态扩展。** 在闸门 A 通过后，按 Embedding → Image → Audio → Video 的顺序补齐 Task 2、Task 4 和 Task 6；每种模态单独通过 fixture、参数门禁和错误测试。
3. **闸门 C：适配器迁移。** Task 5 每次只迁移一个现有适配器；OpenAI 风格和一个异步适配器先行，其余适配器继续走兼容桥，逐个通过后再切换。
4. **闸门 D：产品接入。** 闸门 B/C 稳定后执行 Task 7–8，交付管理向导、三级执行状态、HTTP 文档和薄客户端。
5. **闸门 E：安全发布。** 最后执行 Task 9–10，完成供应链校验、证据台账、支持矩阵和完整回归。

批量查询和动态查询不是首版默认能力：P0 只实现 `per_task`；先保留独立类型和明确拒绝状态，只有存在真实协议 fixture、专用实现和测试后才启用 P1 扩展。

每个里程碑必须先通过本地测试再进入下一阶段；是否提交或创建 PR 由用户单独确认。

### 4.2 兼容性规则

- `adapterId` 是稳定标识，不按模型名称生成新的适配器 ID。
- `adapterVersion` 和 `adapterHash` 用于记录已运行的 manifest/源码版本；同一版本内容不可原地替换，旧记录为空时按当前兼容版本校验，不自动改写用户配置。
- 适配器索引是派生缓存；索引中的显示信息、模型列表或 SHA256 不能覆盖源码重新解析出的 manifest。
- 模型身份可以由 exact/normalized/alias 绑定高置信识别；执行契约必须来自适配器、供应商证据或人工确认，参数画像可以另外来自目录，但不因模型名命中而自动覆盖供应商字段。
- 公共字段保持向后兼容；供应商新字段只能进入 `provider_options` 或新的已确认契约。
- 旧 Fal 快照继续可读，但不能覆盖已确认的供应商契约。
- MemeFast 的视频能力只来自已验证协议族和适配器生命周期实现，不能因目录命中而自动获得视频能力；未知家族保持不可执行。
- `new-api-plugins` 只作为适配器设计参考；OpenHub 不依赖其仓库、`channelTypes` 或 JS 运行时。

### 4.3 失败时的产品行为

```text
能识别模型但没有供应商执行契约 -> 显示“需要确认”，禁止执行
有供应商执行契约但目录参数不完整 -> 显示“参数未知/部分已知”，仍允许适配器支持的基础调用
有参数证据但没有适配器能力 -> 显示“适配器缺失”，禁止执行
适配器存在但配置错误 -> 显示“配置无效”，禁止保存可调用变体
身份、契约、适配器或配置任一环节未达标 -> `executionStatus=needs_review` 或 `unavailable`，不把底层组合直接伪装成“正常”
索引与源码 SHA256/manifest 不一致 -> 显示“适配器完整性失败”，禁止注册
同一版本源码发生变化 -> 显示“版本不可变约束失败”，禁止覆盖旧版本
声明 batch/dynamic 但未启用对应扩展或缺少实现 -> 显示“任务策略未支持/不完整”，禁止启用该适配器
请求参数不在模态契约内 -> 调用前返回结构化错误
变体覆盖值在供应商已知边界外 -> 返回字段级参数错误，不静默回退模板默认值
变体覆盖值只是未出现在 fal 模板、但适配器明确支持 -> 允许覆盖并按适配器映射
供应商返回失败 -> 保留统一错误码和已脱敏供应商原因
流式连接中断 -> 返回可识别的流错误，不伪造完整响应
音频 Content-Type 不匹配 -> 返回二进制响应错误，不当作文本成功
视频任务结果缺少媒体 URL -> 标记任务失败，不显示成功
```

---

## 5. 完成定义

本计划只有同时满足以下条件才算完成：

- OpenHub 被定位为多模态模型接入运行时，而不是视频专用系统或模型目录。
- 外部网站或软件可以只依赖 OpenHub 统一 API 完成 LLM、Embedding、图片、音频和视频调用。
- 新增一个常见协议供应商时，不需要修改上层应用代码。
- 新增一个特殊协议供应商时，只需实现 SDK 适配器并注册，不复制路由、参数校验、worker 或数据库逻辑。
- manifest 能描述适配器版本、模态、能力、配置和证据。
- manifest 能描述模型绑定、入站协议、异步任务策略、用量 Schema、产物类型、鉴权方式和证据；生成索引可校验版本与 SHA256。
- 每种模态都有自己的契约、参数校验、错误和合规测试。
- 模型身份识别、模态分类、参数契约和运行时能力不再共用一个“匹配成功”状态。
- 异步任务 P0 只稳定支持逐任务轮询；批量/动态策略有独立接口和明确拒绝状态，未来启用时必须有真实协议证据、专用实现和测试。
- 内置适配器可以单独隔离失败，单个适配器迁移失败不会拖垮其他适配器或整个服务。
- 目录和名称推断只承担建议职责；可执行能力来自已验证供应商契约或适配器。
- 外部目录没有匹配或 Schema 候选未确认时，只影响参数画像和参考映射，不得单独把已验证适配器模型判为不可用。
- 所有可执行模型都显示真实的模态、能力、参数和证据状态。
- 失败、超时、未确认和不支持状态不会伪装成“正常”。
- 服务端测试、适配器合规测试、类型检查、前端构建和安全检查全部通过。
- 没有引入远程代码执行、任意 HTTP 执行、未经证实的供应商协议或无必要基础设施。

## 6. 计划自检结论

- **需求修正：** 用户目标是 LLM、Embedding、图片、音频和视频的统一平台；视频仅作为最复杂链路验证，不再作为唯一核心。
- **架构闭环：** 外部应用、公共 API、模态契约、适配器 manifest、供应商适配器、worker、Schema 和管理界面均有对应任务。
- **插件学习已落位：** 吸收 `manifest`、模型显式绑定、生命周期钩子、产物/用量、任务策略、不可变版本、派生索引和 SHA256/CI 校验；不吸收远程 JS 执行。
- **维护成本控制：** 不按模型复制代码，不开放任意执行器，不把目录当执行合同，保留专用适配器处理真正的供应商差异。
- **证据边界：** 当前代码事实已标明；未来协议覆盖率、供应商 Schema 和 MemeFast 视频能力必须通过官方文档或 fixture 验证。
- **长期定位：** OpenHub 是统一多模态模型接入网关和受信任适配器平台；“即插即用”表示上层应用接口稳定、适配器可版本化接入，不表示供应商协议可以被无证据自动猜出或由远程脚本任意执行。
