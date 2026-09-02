# OpenHub 证据门禁与多模态模板执行计划

> **状态：已执行并完成自动/本地网页验收；真实视频计费调用仍未执行**
>
> **日期：2026-08-31**
>
> **适用范围：LLM、Embedding、图片、音频、视频，以及所有供应商适配器**
>
> **For agentic workers:** 按任务顺序执行；每个任务先写失败检查，再写最小实现，再运行任务级验证；本计划不默认提交 Git 或创建 PR。

**Goal:** 把 OpenHub 从“看起来匹配了就能调用”修正为“证据充分才允许调用”的多模态模型注册表与统一网关，同时让 Fal.ai Schema 真正成为可校验、可映射、可被变体使用的参数模板。

**Architecture:** 保留现有站点、模型、变体、任务 worker、适配器和 Schema 目录，不另建一套平行系统。Schema 只提供参数结构和默认建议；适配器 manifest 与代码负责协议、生命周期、字段映射和结果转换；模型身份、参数契约、运行时可用性分开判断。常见协议继续使用代码内置的声明式模板，供应商私有协议必须由已验证适配器实现，不能由网页填写 URL、HTTP 方法、响应选择器或脚本。

**Tech Stack:** TypeScript、Hono、Drizzle SQLite、原生 fetch、现有 Zod、Node node:test、React/Vite、pnpm workspace、Node 22 LTS；不新增依赖。

## Global Constraints

- 保留供应商原始模型 ID；任何目录别名、显示名或变体名都不能写回 models.rawName，也不能替换转发请求中的 model。
- 名称规则可以识别厂商、模型族和模态候选，但不能单独证明供应商协议、字段和任务生命周期。
- Fal.ai Schema 是参数模板，不是供应商执行协议，也不能把 schemaEndpointId 当成 MemeFast 或其他站点的真实模型 ID。
- ready 只表示静态契约和适配器绑定通过；站点健康、模型最近探测成功、模板可执行必须分别展示。
- 只有适配器代码、官方文档、fixture、运行时证据或管理员明确确认，才能形成可执行证据。
- 未映射的用户参数必须放入受控的 provider_options，或返回带字段名的明确错误；不能静默丢弃后假装成功。
- 比例、分辨率、时长以及参考图片/视频/音频数量属于可变参数；只要没有超过模型和适配器限制，就不能因为不同于模板默认值而回退或拒绝。
- 视频提交和查询必须使用同一份已验证协议绑定；查询不能再次根据模型名称猜协议。
- 不自动发送会产生费用的图片、音频或视频任务；真实视频调用只有在用户单独授权后才执行。
- 不为 gpt-5.5、deepseek-*、veo-* 或任何单个模型增加特判；规则必须对同一模型族和同一协议中的任意模型 ID 有一致行为。
- 不引入新的远程插件执行机制，不允许数据库配置任意外部请求。
- 所有修改前先备份涉及文件和数据库；不重置当前工作树已有改动，不在本计划内提交或创建 PR。

---

## 0. 独立分析与边界结论

### 0.1 已确认事实

- 当前唯一应执行的代码工作树是 E:\code\openhub\worktrees\memefast-connector，分支为 codex/feat/memefast-connector；不能混用 repo 工作树的后端和本工作树的前端。
- 当前基线全量测试为 83 项通过，Node 22 定向测试为 31 项通过；类型检查、适配器索引检查和前端构建均通过。
- 本地网页入口是 http://localhost:5173，后端由 Vite 代理到 http://localhost:3000。
- 当前 MemeFast 站点使用 https://api.memefast.cc/v1；站点级连接正常不等于每一个模型、模态和协议都可调用。
- 当前模型快照为 467 个：LLM 314、图片 51、音频 35、Embedding 10、视频 54、未知 3。
- 当前执行状态快照为 462 个 ready、5 个 needs_review；Schema 为确认 0、候选 96、未匹配 371。
- 当前只有 4 个变体，没有真实视频变体；真实视频提交和查询尚未执行，因而没有真实视频成功证据。
- packages/server/src/lib/model-contract.ts:546 的 buildCapabilityContract() 只要适配器声明模态能力，就会把契约状态设为 confirmed，没有要求模型级协议、字段和生命周期证据。
- packages/memefast/src/client.ts:62 仍会在没有显式协议时根据模型名称正则选择视频协议；这会把名称猜测当成执行路由。
- packages/adapter-sdk/src/manifest.ts:18 已有 modelBindings、protocolBindings、taskStrategy 和 evidence，但没有声明 Schema 模板兼容性、字段映射和可变字段边界。
- packages/server/src/routes/admin/wizard.ts:307、:423、:471 的 Schema 应用路径目前主要检查模态、参数存在和适配器能力，没有完成模型身份、操作、字段映射和提交/查询生命周期的完整兼容检查。
- packages/server/src/engine/catalog/schema-matcher.ts:174 目前主要检查模态、适配器能力和参数是否非空，没有真正验证 Schema 字段能否进入目标适配器。
- packages/server/src/engine/param-mapper.ts 已有 param_defaults、param_overrides、param_blocked 和 field_mapping 的管线，但数据库中的变体表没有独立的 param_defaults 字段；这与 DESIGN.md 对“默认值”和“强制覆盖”的描述存在冲突。
- packages/server/src/db/schema/model-capability-probes.ts 已有按模型和能力保存探测结果的表，但现有探测主要证明站点列表可访问，不能证明非 LLM 模型已经可执行。

### 0.2 合理推测

- 模型名称通常足以推断厂商、模型族和模态，尤其是格式稳定的模型名；但同名、别名、路由别名和中转站自定义名仍可能存在，因此名称不能单独推出私有协议和字段。
- Fal Schema 能很好地补全字段名、类型、枚举、默认值、尺寸、时长和参考媒体限制；它不能证明 MemeFast 一定支持同样的 endpoint、提交地址、查询地址或结果结构。
- 当前视频模型大量显示“不可用/待确认”的根因不是模型一定不存在，而是系统把“有模型名”“有目录候选”“适配器声明视频能力”“真实协议可执行”混在了一起。
- 对于异步视频，最容易出现的根本错误是提交时按一种猜测发送，查询时按另一种猜测解析；协议绑定必须随任务保存。

### 0.3 未验证假设

- MemeFast 是否为每一个视频模型提供统一视频协议、是否支持某个 Fal endpoint 的全部字段，当前没有逐模型官方文档或无费用验证结果。
- 不同供应商是否提供无费用的 validate/dry-run 接口，当前没有统一证据；不能把一次 /v1/models 成功当成生成能力验证。
- 当前 54 个视频模型中，哪些可以通过已有 MemeFast 协议直接工作，哪些只是供应商名称映射，必须在协议 fixture 或用户授权的真实调用中逐一确认。

### 0.4 直接结论

本计划能务实达到的目标是：

1. OpenHub 不再把目录匹配或名称猜测伪装成可执行协议。
2. Fal Schema 可以作为模板套入变体，生成默认参数、限制和字段映射。
3. 用户可以修改比例、分辨率、时长和参考媒体数量；系统按真实限制校验，不因偏离默认值而回退。
4. 已有适配器和证据的模型可以直接进入统一调用链。
5. 没有证据的模型仍会显示在目录中，但会明确显示身份、契约、运行时缺哪一项，不会被错误标成正常。

本计划不能承诺“所有供应商的所有私有参数自动识别并自动可调用”。没有供应商协议证据时，正确结果是待配置或不可用，而不是继续堆名称正则制造假成功。

## 1. 目标状态

### 1.1 四条独立证据链

| 证据链 | 证明什么 | 不能证明什么 |
|---|---|---|
| 发现 | 站点返回了原始模型 ID | 不能证明有权限或能生成 |
| 身份 | 这是哪个厂商/模型族/版本 | 不能证明参数和任务协议 |
| 契约 | 接受哪些字段、字段如何映射、如何返回 | 不能证明当前 Key 正常 |
| 运行时 | 当前站点、当前 Key、当前协议最近结果 | 不能永久代表未来可用 |

### 1.2 状态定义

| 页面状态 | 必须满足 | 用户看到的含义 |
|---|---|---|
| 已发现 | /v1/models 返回原始 ID | 系统知道它存在 |
| 已归类 | 名称/目录/元数据能稳定推断厂商、族或模态 | 系统知道它大概是谁 |
| 身份已确认 | manifest 精确绑定、运行时明确身份、唯一目录匹配或管理员确认 | 系统有足够证据认为它是谁 |
| Schema 候选 | 找到可能的参数模板但仍有冲突或缺证据 | 可以查看，不能直接套用执行 |
| 模板可应用 | 模态、操作、字段映射、生命周期和适配器兼容 | 可以生成变体配置 |
| 可执行未实测 | 静态契约通过，但没有安全实时探测 | 可以调用，但页面必须标明未实测 |
| 最近可用 | 同站点、同 Key、同模型、同能力探测成功 | 最近一次调用通过 |
| 待复核 | 身份、协议或关键参数证据不足 | 不能作为正常可调用模型 |
| 不可用 | 适配器缺失、协议不支持、权限拒绝或明确不兼容 | 当前禁止调用 |

站点正常只能表示站点健康；不能替代上述模型级状态。正常标签不再单独代表模型可以生成视频。

### 1.3 模板套用后的真实流程

~~~text
站点发现 rawName
  -> 身份/模态分类
  -> 目录给出 Fal Schema 候选
  -> 适配器检查操作、协议、字段映射和生命周期
  -> 通过后保存模板快照、默认值、限制和映射
  -> 用户创建/修改变体
  -> 请求使用变体默认值；调用方显式参数优先
  -> 只校验真实限制，不把用户参数回退成模板默认值
  -> 适配器按已验证协议提交和查询
~~~

## 2. 文件变更地图

### 2.1 复用并修改

- packages/adapter-sdk/src/common.ts：补充模板操作和值类型，不放供应商 URL 或脚本。
- packages/adapter-sdk/src/manifest.ts：声明适配器可接受的模板绑定、字段映射和证据。
- packages/adapter-sdk/src/conformance.ts：校验模板绑定与 manifest 能力、模态和证据的一致性。
- packages/server/src/engine/adapter-manifest.ts：Zod manifest 校验、内置适配器模板声明和公开诊断。
- packages/server/src/lib/model-contract.ts：把模板兼容性和协议证据纳入契约状态与执行门禁。
- packages/server/src/engine/catalog/schema-matcher.ts：从“找到 Schema”升级为“找到并评估可应用模板”。
- packages/server/src/routes/admin/wizard.ts：Schema 应用、模板确认、变体生成使用统一兼容性结果。
- packages/server/src/engine/param-mapper.ts：区分默认参数和强制覆盖，拒绝未受控的未知字段。
- packages/server/src/db/schema/variants.ts、packages/server/src/routes/admin/variants.ts：保存模板默认值并允许合法变体覆盖。
- packages/server/src/db/schema/sites.ts、packages/server/src/db/schema/model-capability-probes.ts：绑定站点配置版本与探测结果。
- packages/server/src/engine/capability/probes.ts、packages/server/src/engine/capability/status.ts：区分站点健康、模型存在、契约不匹配、权限和临时故障。
- packages/server/src/engine/adapters/memefast.ts、packages/memefast/src/client.ts、packages/memefast/src/types.ts：只使用显式、已验证的视频协议绑定；提交和查询复用同一绑定。
- packages/server/src/engine/tasks/worker.ts、packages/server/src/routes/v1/video.ts：保存并使用任务级协议绑定，修正异步生命周期。
- packages/server/src/routes/admin/models.ts、packages/web/src/pages/Models.tsx、packages/web/src/pages/Wizard.tsx：展示分离后的身份、模板、契约和运行时状态，并保留用户输入。
- packages/server/src/routes/admin/sites.ts：站点凭据、地址或适配器改变时递增配置版本。
- DESIGN.md、docs/ADAPTER-SDK.md、docs/MULTIMODAL-INTEGRATION.md、docs/MULTIMODAL-PROVIDER-EVIDENCE.md、docs/VIDEO-PROTOCOL-EVIDENCE.md：消除默认值、Schema、视频协议和状态语义的冲突。

### 2.2 新增但保持最少

- packages/server/drizzle/0010_evidence_gated_templates.sql：只增加变体模板默认值和站点/探测配置版本所需字段。
- packages/server/test-schema-template-compatibility.ts：覆盖 Schema 模板兼容性决策，不为单个模型写特判。

不新增模板数据库大表；现有 model_schema_catalog 保存 Schema，模型保存关联快照，变体保存应用后的默认值、限制和映射，足够支撑当前产品。

## 3. 分阶段执行任务

### Task 0：建立基线、备份和单工作树验证

**Files:**
- Create during execution: backups/evidence-gated-template-20260831/
- Read only: E:\code\openhub\worktrees\memefast-connector 的 git status、数据库备份输出和基线日志

**Steps:**

- [ ] 记录工作树、分支、Node、pnpm、前端端口、后端端口和数据库路径。

~~~powershell
Get-Location
git status --short --branch
node --version
pnpm --version
pnpm --filter @openhub/server db:backup
~~~

- [ ] 备份本计划后续会修改的源文件、Drizzle schema、迁移文件、配置文件和数据库；备份不能覆盖已有备份。
- [ ] 在同一工作树运行基线检查并保存输出：

~~~powershell
pnpm --filter @openhub/server typecheck
pnpm --filter @openhub/server test
pnpm --filter @openhub/server adapter-index:check
pnpm --filter @openhub/web build
~~~

- [ ] 确认前端和后端都从 E:\code\openhub\worktrees\memefast-connector 启动；若端口已有其他工作树进程，先停止或换用同一工作树进程。

**Gate:** 基线命令结果、备份路径和运行工作树可复现；如果基线失败，先记录失败原因，不把环境问题归因给本计划。

### Task 1：补齐适配器模板与证据声明

**Files:**
- Modify: packages/adapter-sdk/src/common.ts
- Modify: packages/adapter-sdk/src/manifest.ts
- Modify: packages/adapter-sdk/src/conformance.ts
- Modify: packages/server/src/engine/adapter-manifest.ts
- Test: packages/server/test-adapter-sdk.ts
- Test: packages/server/test-adapter-registry.ts
- Test: packages/server/test-adapter-security.ts

**Interfaces:** 新增的 SDK 声明只描述能力和映射，不描述可由用户输入的网络动作：

~~~typescript
export type TemplateOperation =
  | "chat"
  | "embedding"
  | "image.generation"
  | "image.edit"
  | "image.variation"
  | "audio.speech"
  | "audio.transcription"
  | "video.submit"
  | "video.query";

export interface AdapterTemplateBinding {
  id: string;
  modality: Modality;
  operations: TemplateOperation[];
  mapperId: string;
  fields: Record<string, {
    target: string;
    required?: boolean;
    overridable?: boolean;
  }>;
  evidence: EvidenceRef[];
}
~~~

**Steps:**

- [ ] 先在 test-adapter-sdk.ts 增加失败检查：缺少 mapperId、缺少 evidence、模板声明了不存在的操作、视频模板缺少 video.submit 或 video.query 时注册失败。
- [ ] 在 SDK manifest 类型和 Zod schema 中加入 templateBindings；拒绝重复模板 ID、重复字段、空目标字段和不在 manifest 能力列表中的操作。
- [ ] 在 conformance 校验中禁止模板声明 url、method、headers、script、selector 等远程执行字段；这些只能由适配器源码实现。
- [ ] 为 openai、memefast 及当前已有视频适配器声明真实存在的模板绑定；没有文档、fixture 或运行时证据的绑定不标为 confirmed。
- [ ] memefast 的协议 ID 可以是 veo、kling、seedance 等代码内置协议，但 manifest 不得把某个模型名写成路由条件；协议绑定由变体配置选择，模型 ID 原样传递。
- [ ] 将模板绑定和证据加入适配器索引检查与管理端公开诊断。

**Minimal check:**

~~~typescript
const result = validateAdapterManifest(manifestWithTemplate);
assert.equal(result.ok, true);
assert.equal(validateAdapterManifest(manifestWithArbitraryUrl).ok, false);
~~~

**Gate:** 一个适配器能明确回答“支持什么操作、哪些字段可映射、哪些字段可变、证据在哪里”，但不能通过网页配置任意请求。

### Task 2：收紧模型身份、契约和执行状态

**Files:**
- Modify: packages/server/src/lib/model-contract.ts
- Modify: packages/server/src/engine/capability/status.ts
- Modify: packages/server/src/engine/adapter-manifest.ts
- Test: packages/server/test-model-contract.ts
- Test: packages/server/test-probe-classification.ts
- Test: packages/server/test-model-matching.ts

**Interfaces:** 在现有契约输入上增加模型级模板证据：

~~~typescript
export interface TemplateEvidenceInput {
  decision: "confirmed" | "candidate" | "incompatible";
  templateId: string | null;
  operations: string[];
  requiredFieldsMapped: boolean;
  lifecycleConfirmed: boolean;
  reason: string;
}

export interface CapabilityContractInput {
  modality: Modality;
  identity: ModelIdentityEvidence;
  inferred: InferredCapability;
  runtimeMetadata?: Record<string, unknown>;
  adapterCapabilities: string[];
  adapterValidationStatus?: string | null;
  templateEvidence?: TemplateEvidenceInput | null;
}
~~~

**Steps:**

- [ ] 先补回归测试：仅因为适配器声明 video.submit/video.query，契约不能自动为 confirmed；没有显式协议和生命周期证据时必须为 candidate、partial 或 unverified。
- [ ] 保留名称识别对厂商、模型族和模态的价值：名称规则可以形成高置信分类候选；但 UI 要显示“名称高置信、协议未确认”，不能把分类结果伪装成执行契约。
- [ ] 保留精确目录匹配、适配器 manifest、运行时明确元数据和管理员确认的高可信身份来源；冲突候选进入 ambiguous，不自动改名。
- [ ] 修改 buildCapabilityContract()：契约 confirmed 至少同时要求适配器实现目标操作、模板兼容性 confirmed、必需字段已映射、异步模态生命周期已确认；视频额外要求提交和查询属于同一绑定。
- [ ] 修改 deriveExecutionStatus()：适配器无实现、模板不兼容、关键协议缺失时返回 unavailable 或 needs_review；静态通过但未探测时保留“可执行未实测”诊断，不伪造“最近可用”。
- [ ] 把 templateId、证据来源、未映射字段、生命周期和拒绝原因写入现有契约快照与 reason 字段，保证页面可以解释判断。
- [ ] 修正 classifyProbeFailure()：404 只有在上游消息明确指向模型/endpoint 不存在时才判定 unsupported；否则保留 request_invalid 或 contract_mismatch，不能直接说模型不存在。

**Minimal check:**

~~~typescript
const contract = buildCapabilityContract({
  modality: "video",
  identity: { status: "recognized", source: "catalog", reason: "exact_catalog_match" },
  inferred: videoInference,
  adapterCapabilities: ["video.submit", "video.query"],
  templateEvidence: null,
});
assert.notEqual(contract?.status, "confirmed");
~~~

**Gate:** “适配器支持视频”不再等于“这个模型的协议已确认”；模型页面能分别显示身份、契约和运行时状态。

### Task 3：把 Fal Schema 变成可应用模板，而不是只读候选

**Files:**
- Modify: packages/server/src/engine/catalog/schema-matcher.ts
- Modify: packages/server/src/routes/admin/wizard.ts
- Modify: packages/server/src/routes/admin/models.ts
- Create: packages/server/test-schema-template-compatibility.ts
- Test: packages/server/test-model-contract.ts

**Interfaces:** 在 Schema matcher 中增加可解释的兼容性结果：

~~~typescript
export interface SchemaTemplateCompatibility {
  decision: "confirmed" | "candidate" | "incompatible";
  templateId: string | null;
  operations: string[];
  fieldMapping: Record<string, string>;
  overridableFields: string[];
  requiredFields: string[];
  unmappedRequiredFields: string[];
  unsupportedFields: string[];
  reasons: string[];
}

export function evaluateSchemaTemplateCompatibility(input: {
  model: ModelRow;
  schema: SchemaCatalogCandidate;
  registration: AdapterRegistration;
  protocolId?: string | null;
}): SchemaTemplateCompatibility;
~~~

**Steps:**

- [ ] 先写 test-schema-template-compatibility.ts：同一 Schema 在模态不匹配、缺少操作、必填字段无映射、视频缺少查询生命周期时分别返回 incompatible 或 candidate，不能返回 confirmed。
- [ ] 让 matcher 继续保存候选 endpoint、标题、参数快照和来源，但把“匹配到 Schema”和“模板可以执行”分成两个结果。
- [ ] 兼容性检查必须验证：模态一致、目标操作存在、模板绑定存在、所有必填字段能映射到 OpenHub 标准字段或受控 provider_options、映射目标属于适配器允许字段、异步提交/查询生命周期一致。
- [ ] Schema 字段没有直接映射时只能进入 provider_options.<adapter-namespace>，并且必须由适配器的 mapperId 解释；不允许把未知字段直接拼进 HTTP 请求。
- [ ] POST /admin/wizard/:modelId/apply-schema 只在兼容性 confirmed 时写入可执行关联；candidate 只能保存候选快照和原因；incompatible 返回 409 并逐字段说明原因。
- [ ] 向导确认和模型编辑复用同一个兼容性函数，不能一个入口严格、另一个入口绕过门禁。
- [ ] 应用 Schema 时只写 schemaEndpointId、快照、匹配状态、模板证据和映射结果；绝不把 Fal endpoint ID 写入 rawName 或变体对外名称。

**Expected response shape:**

~~~json
{
  "data": {
    "decision": "candidate",
    "templateId": "fal-schema",
    "unmappedRequiredFields": ["content"],
    "unsupportedFields": [],
    "reasons": ["video_query_lifecycle_not_bound"]
  }
}
~~~

**Gate:** Fal Schema 可以被应用为模板，但只有适配器证据足够时才可以进入可执行变体；“Schema 匹配成功”不再等于“请求一定成功”。

### Task 4：修正变体默认值、覆盖值和字段映射

**Files:**
- Modify: packages/server/src/db/schema/variants.ts
- Modify: packages/server/src/routes/admin/variants.ts
- Modify: packages/server/src/routes/admin/wizard.ts
- Modify: packages/server/src/engine/param-mapper.ts
- Modify: packages/server/src/lib/model-contract.ts
- Create: packages/server/drizzle/0010_evidence_gated_templates.sql
- Modify: packages/server/src/db/init.ts
- Modify: packages/server/test-param-mapper.ts
- Modify: packages/server/test-video-contract.ts
- Modify: packages/server/test-reference-media.ts

**Data change:** 在 variants 增加 param_defaults；保留旧 param_overrides 的强制覆盖语义，不把历史数据静默改义。

~~~sql
ALTER TABLE variants ADD COLUMN param_defaults TEXT;
ALTER TABLE sites ADD COLUMN config_revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE model_capability_probes ADD COLUMN config_revision INTEGER NOT NULL DEFAULT 1;
~~~

**Steps:**

- [ ] 先写失败测试，证明调用方显式传入 aspect_ratio、resolution、duration 或参考媒体时，变体默认值不会覆盖它们。
- [ ] param_defaults 只在调用方未设置字段时填充；param_overrides 仍只用于管理员明确锁定的字段；param_blocked 仍用于禁止字段。
- [ ] 统一参数管线为：解析调用方输入 → 删除 blocked → 填充 defaults（只填缺失）→ 应用 explicit overrides → 注入适配器固定值 → 字段映射 → 适配器代码转换 → 未知字段处理 → 契约和限制校验。
- [ ] Schema 应用把 Schema 默认值写入 param_defaults，把用户选择的变体固定值写入 param_overrides，不再把所有模板默认值写成强制覆盖。
- [ ] field_mapping 只能使用兼容性结果允许的源字段和目标字段；用户不能通过它改变 URL、鉴权、协议、查询地址或结果选择器。
- [ ] duration、aspect_ratio、resolution 依照模型 fieldNodes、Schema 枚举/范围和适配器限制校验；用户修改合法值时保留用户值，非法值返回 400 model_constraint_invalid 并指出字段和允许范围。
- [ ] 参考媒体按数量上限检查：maxReferenceImages、maxReferenceVideos、maxReferenceAudios 是上限，不是模板默认数量；在上限内改变数量必须通过。
- [ ] 未知顶层参数不再静默丢弃：如果不是标准字段、Schema 已确认字段或适配器映射字段，则要求放入 provider_options，否则返回 unknown_parameter。
- [ ] 对 provider_options 保留命名空间、对象类型校验、大小上限和适配器白名单；未知命名空间不能透传。
- [ ] 更新 DESIGN.md 第 8、9 章，把 param_defaults 与 param_overrides 的语义写成唯一规则，并删除“未知字段无条件丢弃”的冲突描述。

**Minimal check:**

~~~typescript
const mapped = mapStoredVariantParams(
  { model: "video-variant", aspect_ratio: "9:16", resolution: "1080p", duration: 8 },
  {
    paramDefaults: JSON.stringify({ aspect_ratio: "16:9", resolution: "720p", duration: 5 }),
    paramOverrides: null,
    paramBlocked: null,
    fieldMapping: null,
  },
  ["model", "aspect_ratio", "resolution", "duration"],
);
assert.equal(mapped.body.aspect_ratio, "9:16");
assert.equal(mapped.body.resolution, "1080p");
assert.equal(mapped.body.duration, 8);
~~~

**Gate:** 套模板后用户可以按目标修改比例、分辨率、时长和参考媒体数量；系统只拒绝超出证据范围的值，不会把合法自定义配置回退掉。

### Task 5：移除 MemeFast 视频名称猜协议，固定提交/查询生命周期

**Files:**
- Modify: packages/memefast/src/client.ts
- Modify: packages/memefast/src/types.ts
- Modify: packages/server/src/engine/adapters/memefast.ts
- Modify: packages/server/src/engine/adapter-manifest.ts
- Modify: packages/server/src/routes/v1/video.ts
- Modify: packages/server/src/engine/tasks/worker.ts
- Modify: packages/server/test-memefast-adapter.ts
- Modify: packages/server/test-video-adapters.ts
- Modify: packages/server/test-video-contract.ts

**Steps:**

- [ ] 先写回归测试：两个完全不同、但都属于同一协议的任意模型 ID，在显式 video.protocol 下必须走同一映射；没有显式协议时必须返回 video_protocol_unverified；模型名不能改变协议选择。
- [ ] 删除 packages/memefast/src/client.ts:62 的正则回退路径；videoProtocol() 只接受已经通过适配器配置校验的显式协议绑定。
- [ ] 不允许调用方在请求体 provider_options 中切换协议；协议只能来自管理员确认的变体 adapterConfig 或已验证模型绑定。
- [ ] 每个协议定义提交路径、查询路径、方法、请求构造、状态映射和结果解析；这些定义必须在适配器源码中，不能由 Schema 或网页动态传入。
- [ ] 视频提交成功后，把 protocol_id、适配器 ID、适配器版本和原始模型 ID 写入任务元数据；worker 查询使用任务保存的协议，不再按模型名重新猜测。
- [ ] MemeFast 适配器配置缺少视频协议时，在变体创建/更新阶段返回 adapter_config_invalid 或 contract_unconfirmed，而不是创建一个必失败变体。
- [ ] Fal Schema 的 endpointId 只作为参数模板来源；除非 MemeFast 适配器有对应协议证据，否则不能直接把 fal-ai/... 当作 MemeFast 请求路径或模型名。
- [ ] 对每个已有协议补充官方文档、fixture 或运行时记录；没有证据的协议保留为 candidate，不标记为 verified。
- [ ] 更新 docs/VIDEO-PROTOCOL-EVIDENCE.md，逐协议记录“已证明提交、已证明查询、已证明结果、未证明参数”，不写“适配器声明了所以可用”。

**Minimal check:**

~~~typescript
await assert.rejects(
  () => connector.videoSubmit({ model: "arbitrary-video-id", prompt: "test" }),
  (error: unknown) => error instanceof MemeFastError && error.code === "video_protocol_unverified",
);
~~~

**Gate:** 提交和查询只走同一份显式协议证据；任意模型名不会偷偷触发错误的供应商路径。

### Task 6：修正探测记录、凭据版本和错误分类

**Files:**
- Modify: packages/server/src/db/schema/sites.ts
- Modify: packages/server/src/db/schema/model-capability-probes.ts
- Modify: packages/server/src/routes/admin/sites.ts
- Modify: packages/server/src/engine/capability/probes.ts
- Modify: packages/server/src/routes/admin/probes.ts
- Modify: packages/server/src/engine/capability/status.ts
- Modify: packages/server/test-probe-classification.ts
- Modify: packages/server/test-adapter-security.ts

**Steps:**

- [ ] 迁移并使用 sites.config_revision：只在 base URL、API Key 或站点 adapter 改变时递增；健康检查和普通列表刷新不递增。
- [ ] 探测记录保存当前 config_revision；读取“最近探测”时只使用与站点当前版本一致的记录，防止旧 Key 的成功结果污染新 Key。
- [ ] 保留现有 safe/full 模式，但明确 safe 的 /v1/models 只能证明列表可读；不能写成 available。LLM 最小请求可以由管理员单模型显式触发；图片、音频、视频默认不发送计费任务。
- [ ] 把探测入口下沉到适配器：适配器决定该模态安全探测是否存在，服务器只允许已注册能力，不接受网页自定义请求地址、脚本或响应 selector。
- [ ] 统一记录 HTTP 状态、上游错误码、脱敏消息、请求 ID、Retry-After、延迟、适配器版本和配置版本；不记录 API Key、完整提示词或完整媒体数据。
- [ ] 分类规则固定为：401/403 是 forbidden；429、5xx、超时和网络错误是 temporary_failure；明确模型不存在才是 unsupported；探测请求参数错误是 request_invalid；响应结构错误是 contract_mismatch。
- [ ] /admin/probes 返回 site_health、model_listed、capability_probe 三类字段，避免管理员误读站点健康为模型可用。

**Gate:** 同一模型能明确区分“存在、契约可执行、最近成功、暂时失败、无权限、参数错误和协议不匹配”。

### Task 7：管理页面真实表达状态，并保留自定义输入

**Files:**
- Modify: packages/server/src/routes/admin/models.ts
- Modify: packages/server/src/routes/admin/wizard.ts
- Modify: packages/server/src/routes/admin/variants.ts
- Modify: packages/web/src/pages/Models.tsx
- Modify: packages/web/src/pages/Wizard.tsx
- Modify: packages/web/src/pages/Catalog.tsx
- Modify: packages/web/index.html
- Test: packages/client/test/client.test.ts

**Steps:**

- [ ] 模型表格分开显示：一级厂商、模态、身份来源/置信度、Catalog 匹配、Schema 模板决策、契约状态、运行时探测状态和操作原因。
- [ ] 保留并验证一级厂商和二级模态筛选：LLM、Embedding、图片、音频、视频、未知；筛选只改变视图，不修改模型数据。
- [ ] 将“正常”限定为站点健康；视频行显示“可执行未实测”“协议未确认”“模板候选”“最近可用”等具体状态。
- [ ] Schema 向导展示字段映射、必填未映射字段、可变字段、默认值和限制；用户修改 ratio、resolution、duration 或参考媒体数量时，不自动把控件值重置成模板默认值。
- [ ] 服务端拒绝时返回字段级错误；前端保留用户当前输入，并在对应字段显示允许值或上限。
- [ ] “套用模板”与“确认执行”使用不同动作：套用候选只能保存候选；确认执行必须显示证据和兼容性结果，不能藏在普通保存按钮里。
- [ ] “测试调用”按钮只触发固定的适配器探测；视频按钮明确提示可能产生费用，并默认禁用真实生成测试。
- [ ] 修复已知 DOM 嵌套按钮警告：可点击卡片和内部操作按钮不能互相嵌套；同时不把 React Router future flag 当成供应商错误。
- [ ] 增加 favicon.ico 或在 packages/web/index.html 使用实际存在的资源，消除无关的 404 噪音。

**Gate:** 管理员能在页面上回答“它是谁、能接受什么、模板是否能用、当前是否实测、为什么不能用”，并且自定义参数不会被界面偷偷改回去。

### Task 8：数据修复、回归验证和本地网页验收

**Files:**
- Modify: packages/server/test-model-profile-sync.ts
- Modify: packages/server/test-model-matching.ts
- Modify: packages/server/test-model-contract.ts
- Modify: packages/server/test-param-mapper.ts
- Modify: packages/server/test-video-adapters.ts
- Test: packages/server/test-schema-template-compatibility.ts
- Modify: COMPLETION_STATUS.md
- Modify: docs/OPERATIONS.md

**Steps:**

- [ ] 运行数据库迁移后重新计算模型证据状态；不批量把当前 371 个未匹配或 96 个候选直接改成 confirmed。
- [ ] 对当前 54 个视频模型重新输出诊断：有显式协议和完整证据的进入“可执行未实测/最近可用”；缺协议或只有名称/Schema 候选的进入“待复核/不可用”，并显示具体缺口。
- [ ] 验证重新同步不会改写 rawName、不会覆盖管理员确认、不会把 Fal endpoint 写成站点模型 ID。
- [ ] 使用 mock/fixture 覆盖五类模态：
  - LLM：默认值、工具/流式字段、契约错误。
  - Embedding：字符串和数组输入、维度/编码字段。
  - 图片：尺寸、质量、编辑/变体字段。
  - 音频：语音合成、转写、二进制结果。
  - 视频：提交、查询、状态、结果、参考媒体和参数覆盖。
- [ ] 运行任务级测试：

~~~powershell
pnpm --filter @openhub/server typecheck
pnpm --filter @openhub/server test
pnpm --filter @openhub/server adapter-index:check
pnpm --filter @openhub/web build
pnpm test
~~~

- [ ] 启动同一工作树的后端和前端：

~~~powershell
pnpm --filter @openhub/server start
pnpm --filter @openhub/web dev
~~~

- [ ] 在本地网页执行不计费验收：打开 http://localhost:5173/admin/models，按厂商和模态筛选，检查模型状态；打开向导，套用 mock Schema，修改比例/分辨率/时长/参考媒体数量，确认值不回退；查看候选模板被拒绝时的字段级原因。
- [ ] 在 http://localhost:5173/admin/sites 检查站点健康与模型能力状态分开显示；使用 mock 站点验证发现、Schema 候选和探测错误分类。
- [ ] 不执行真实视频生成；只有在用户单独确认供应商、模型、参数和预算后，才允许做一次可审计的真实调用。
- [ ] 更新 COMPLETION_STATUS.md，逐项记录通过、未完成和未验证，不用“测试通过”替代“供应商协议已证明”。

**Final gate:** 所有自动测试通过；本地页面可完成“发现 → 分类 → Schema 模板 → 兼容检查 → 变体自定义 → 受控调用”的闭环；任何未证实的供应商能力仍明确显示为未证实。

## 4. 验收矩阵

| 场景 | 预期结果 |
|---|---|
| 只有模型名，没有厂商元数据 | 可以归类厂商/族候选；不能凭名称自动选择私有协议 |
| 精确目录匹配 LLM | 身份可确认；参数契约和当前 Key 状态仍独立显示 |
| Fal Schema 命中视频候选 | 显示候选；没有适配器协议证据时不能创建可调用变体 |
| 已验证 Schema + 适配器 | 可以套用模板并生成默认值、限制和字段映射 |
| 用户把 16:9 改为 9:16 | 在 Schema/适配器允许时保留 9:16，不回退 |
| 用户把 1 张参考图改为 2 张 | 在 maxReferenceImages 允许时通过，不按模板默认数量拒绝 |
| 用户传入未知私有参数 | 放入受控 provider_options 并由适配器解释，否则返回明确错误 |
| MemeFast 缺少视频协议 | 变体不可执行，显示 video_protocol_unverified，不按名称猜测 |
| 视频提交后查询 | 使用任务保存的同一协议和模型原始 ID |
| 站点 /v1/models 正常 | 只显示站点健康/模型已发现，不显示生成已验证 |
| Key 更新后读取旧探测 | 旧版本探测失效，不能污染新 Key 的状态 |
| 404 但上游消息不明确 | 保留不确定原因，不直接判为模型不存在 |
| 真实视频探测 | 默认不自动执行，避免意外计费 |

## 5. 维护成本与明确取舍

- 每个新供应商至少需要一个适配器 manifest、一个协议/字段映射实现、证据 fixture 和一组 conformance 测试；这比堆名称正则多一点工作，但能避免线上错误请求。
- Fal Schema 更新只更新目录快照和兼容性评估，不自动改变已经确认的适配器协议；这样目录变化不会悄悄改变生产请求。
- 适配器版本或证据失效后，相关模型进入待复核，而不是继续沿用未知是否正确的旧映射。
- 不做“万能供应商协议生成器”，不做远程脚本执行，不做批量真实生成探测；这三项都能减少代码，却会把风险转移到用户资金、密钥和生产流量上。
- 当前采用 SQLite JSON 字段保存模板快照、默认值和映射，适合单进程 MVP；只有在查询、版本审计或并发编辑成为瓶颈时，才拆成规范化关联表。
- 当前 worker 仍是单进程内存轮询；本计划只修正协议一致性，不借机引入队列、Redis 或分布式调度。

## 6. 完成判定

本计划只有在以下条件全部满足时才算完成：

- [ ] Fal Schema 可以被明确判定为 confirmed、candidate 或 incompatible，且判定原因可追溯。
- [ ] Schema 模板可以进入变体默认参数和字段映射，但不会伪造供应商协议。
- [ ] 合法的比例、分辨率、时长和参考媒体数量覆盖可以保存、转发并保持用户值。
- [ ] 五类模态都经过统一证据门禁；没有单个模型硬编码特判。
- [ ] 视频提交和查询使用同一显式协议绑定；没有名称正则回退。
- [ ] 未知参数不会静默丢失；站点健康不会冒充模型可用。
- [ ] 当前模型数据完成重新评估，未证实项明确降级为候选、待复核或不可用。
- [ ] 自动测试、类型检查、索引检查、前端构建和本地网页验收全部通过。
- [ ] 未执行未经授权的真实视频计费任务。

## 7. 本次执行记录

- 数据库迁移 `0010_evidence_gated_templates` 已成功应用，并核验 `variants.param_defaults`、`sites.config_revision`、`model_capability_probes.config_revision` 均存在。
- 探测结果已增加站点健康、模型是否列出、能力探测三类独立信息；安全探测现在受适配器 `models.list` 能力门禁控制。
- 当前数据库保持 467 个模型，其中视频 54 个；视频契约均为 `unverified`，未被批量伪造为可执行。
- Node 22 服务端测试 85 项、客户端测试 3 项、MemeFast 测试 5 项全部通过；类型检查、适配器索引检查和 Web 构建通过。
- 本地页面已验证 `/admin/models` 的视频筛选、待确认状态、无运行时错误，以及 `/admin/sites` 的站点健康展示；未执行真实视频生成。
- 未完成/未验证：真实供应商视频提交与查询、更多供应商官方协议证据、远程 CI 执行、`favicon.ico`（页面实际使用 `favicon.svg`）。
