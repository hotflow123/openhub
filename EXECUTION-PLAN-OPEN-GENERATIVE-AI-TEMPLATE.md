# Open-Generative-AI 参数模板源接入执行计划

> **For agentic workers:** REQUIRED SUB-SKILL: Execute this plan task-by-task with a review checkpoint after each task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `Open-Generative-AI` 中可验证的模型参数描述提取为 OpenHub 的第二参数模板源，用于参数补全、表单生成、变体校验和字段映射，但不把它误当成供应商执行契约。

**Architecture:** 只在构建/同步阶段读取 `Open-Generative-AI/packages/studio/src/models.js`，生成带来源提交号和文件哈希的版本化快照。OpenHub 将 Fal Schema 与该快照保存为多个独立模板，按模型、模态、操作和适配器兼容性进行证据匹配；模板只决定参数层，真实请求仍由已审查的适配器发送和解析。

**Tech Stack:** TypeScript、Node 22、Drizzle SQLite、Zod、原生 `fetch`、Node `node:test`、React/Vite、pnpm workspace。

## Global Constraints

- `models_dump.json` 不是完整数据源；当前只包含 50 个 `t2i` 模型，不能作为模板二的唯一来源。
- 真实数据源固定为 `packages/studio/src/models.js`；当前读取到 8 组模型数组共 439 条记录、128 个不同输入字段。
- 不在 OpenHub 运行时动态执行外部仓库 JavaScript；外部仓库只允许由维护者在同步脚本中读取并生成快照。
- 记录源仓库提交号、源文件哈希、数组名称、数组索引和生成快照哈希；不能只保存一份无来源 JSON。
- 模板二的 `endpoint`、`provider` 和 `provider_name` 只能作为身份和路由线索，不能覆盖站点适配器地址、路径、鉴权、状态解析或结果解析。
- Fal Schema 与 Open-Generative-AI 模板可以同时存在，禁止互相覆盖；冲突时必须显示冲突并由管理员选择。
- 模型名、相似度或同模态不能单独把模板标记为可执行；模板状态与运行时 `ready` 分开。
- 未映射字段必须显示为未支持或进入已声明的 `provider_options`，不得静默丢弃。
- 变体可以修改适配器已声明且模板/供应商边界允许的比例、分辨率、时长和参考媒体数量；不能因为不是模板默认值就拒绝。
- 不新增远程插件执行器、`eval`、任意 URL/路径配置、远程代码下载或新的第三方依赖。
- 保留原始模型 ID，不自动改名；所有真实运行状态仍必须经过当前站点配置版本下的能力探测。
- 不执行计费供应商请求；没有明确授权时只使用固定快照、fixture 和本地 HTTP 闸门测试。

---

## 1. 独立分析与证据结论

### 1.1 已确认事实

| 事实 | 证据 |
|---|---|
| `Open-Generative-AI` 的完整模型参数主要位于 `packages/studio/src/models.js`。 | 文件导出 `t2iModels`、`t2vModels`、`i2iModels`、`i2vModels`、`v2vModels`、`lipsyncModels`、`recastModels`、`audioModels`。 |
| 当前记录数量为 439 条。 | `72 + 90 + 74 + 132 + 36 + 15 + 3 + 17 = 439`。 |
| 当前记录包含 128 个不同输入字段。 | 对 439 条记录的 `inputs` 键统计。 |
| 参数描述包含类型、枚举、默认值、最小/最大值、步长、数组上限、嵌套对象、示例和说明。 | `models.js` 及 `modelParameters.js`。 |
| 该仓库的前端使用 `inputs` 生成控件，并使用 `endpoint` 调用 `api.muapi.ai`。 | `packages/studio/src/components/ModelParameterControls.jsx`、`packages/studio/src/muapi.js`。 |
| `models_dump.json` 当前只包含 `t2i` 50 条记录。 | 文件顶层只有 `t2i` 数组。 |
| 当前 OpenHub 的 Schema 存储字段主要是 Fal 专用字段。 | `packages/server/src/db/schema/models.ts` 中的 `fal_*` 字段。 |
| 当前 OpenHub 已有参数映射、模板兼容性检查和运行时能力门禁。 | `packages/server/src/engine/param-mapper.ts`、`packages/server/src/engine/catalog/schema-matcher.ts`、`packages/server/src/lib/model-contract.ts`。 |

### 1.2 合理推测

1. 该数据源可以显著补足图片、视频、音频的表单字段、默认值、枚举、尺寸、时长、参考媒体数量和嵌套参数。
2. 这些参数描述更接近 MuAPI 应用层的模型 UI/请求配置，不足以证明 MemeFast 或其他站点接受同样的字段和任务生命周期。
3. `endpoint` 与目标站点模型名可能存在同名、别名或版本差异；它适合作为匹配线索，不适合作为 OpenHub 的执行路径。
4. 同一个模型族可能存在 `t2v`、`i2v`、`v2v`、lipsync、recast 等不同操作，只有 `modality=video` 不足以选择正确参数模板。

### 1.3 未验证假设

1. MemeFast 是否接受某个 Open-Generative-AI 字段名、默认值和枚举，必须由 MemeFast 适配器或真实协议证据确认。
2. Open-Generative-AI 的模型 ID 是否与某个站点的原始模型 ID 一一对应，不能由名称相似直接证明。
3. `audioModels` 中的音乐、音效、TTS、克隆和转换能力不能全部映射为 `audio.speech`；需要按操作和适配器能力分别处理。
4. 当前源仓库未来的模型数组结构可能变化；同步脚本必须在结构变化时失败，而不是静默生成错误快照。
5. 仓库整体声明 MIT 许可，但嵌入生成数据前仍需保留来源和许可说明，并在发布前复核源文件许可范围。

### 1.4 最终判断

**可行，但“模板二”应定义为外部参数百科/表单模板源，不是第二个适配器，也不是第二套供应商 API。**

它能解决：

- OpenHub 只有 Fal Schema 时，图片、视频、音频参数覆盖不足的问题。
- 模型缺少完整 Schema 时，提供可审阅的字段、默认值、枚举和限制候选。
- 变体编辑时，补全比例、分辨率、时长、参考媒体和复杂数组/对象字段。

它不能直接解决：

- MemeFast 的真实请求路径、鉴权方式、任务创建/查询和结果解析。
- 所有供应商的私有参数自动兼容。
- 没有运行探测时把模型变成 `ready`。

---

## 2. 目标流程

执行完成后，单个模型的参数流程必须是：

```text
同步 Open-Generative-AI 快照
-> 按模型 ID / 厂商 / 家族 / 版本 / 模态 / 操作匹配
-> 生成候选模板并保留证据
-> 检查适配器字段映射和必填字段
-> 管理员选择并应用模板
-> 变体覆盖比例、分辨率、时长、参考数量
-> 适配器按映射构造真实请求
-> 运行时能力探测通过后才允许调用
```

### 2.1 模板状态

| 状态 | 含义 |
|---|---|
| `candidate` | 有身份/模态/操作线索，但尚未确认能用于目标站点。 |
| `confirmed` | 模板结构有效，身份、模态、操作和适配器绑定通过兼容性检查。仍不代表真实运行成功。 |
| `applied` | 管理员明确选用该模板作为某个变体的参数基线。仍不代表运行时 `ready`。 |
| `incompatible` | 模态、操作、必填字段或适配器能力不兼容。 |
| `conflict` | 与另一个已应用模板在同一操作上存在字段、默认值或限制冲突，必须人工选择。 |

### 2.2 操作维度

不得只保存 `video` 或 `audio` 作为模板类型。至少保存：

| 源数组 | 建议操作 | 运行能力要求 |
|---|---|---|
| `t2iModels` | `image.text_to_image` | `image.generation` |
| `i2iModels` | `image.image_to_image` | `image.edit` 或适配器声明的图片能力 |
| `t2vModels` | `video.text_to_video` | `video.submit` + `video.query` |
| `i2vModels` | `video.image_to_video` | `video.submit` + `video.query` |
| `v2vModels` | `video.video_to_video` | `video.submit` + `video.query` |
| `lipsyncModels` | `video.lipsync` | 适配器声明的 lipsync/视频任务能力 |
| `recastModels` | `video.recast` | 适配器声明的 recast/视频任务能力 |
| `audioModels` | 源操作保留，按适配器决定 `audio.speech`、`audio.transcription` 或扩展能力 | 不允许把全部音频记录强行归为 TTS |

---

## 3. 文件地图

| 区域 | 文件 | 责任 |
|---|---|---|
| 源提取 | `packages/catalog/tools/import-open-generative-ai.ts` | 从固定本地仓库读取模型数组，校验并生成快照 |
| 通用类型 | `packages/catalog/src/parameter-template.ts` | 规范化输入字段、操作、来源和证据类型 |
| 生成快照 | `packages/catalog/data/open-generative-ai.snapshot.json` | 部署时使用的版本化数据，不在运行时执行源仓库代码 |
| 数据库存储 | `packages/server/src/db/schema/model-parameter-templates.ts` | 保存多个来源、多个操作的模板和证据 |
| 变体选择 | `packages/server/src/db/schema/variants.ts` | 保存变体选择的模板 ID |
| 模板匹配 | `packages/server/src/engine/catalog/parameter-template-matcher.ts` | 统一匹配、字段映射、兼容性和冲突判定 |
| Fal 适配 | `packages/server/src/engine/catalog/schema-matcher.ts` | 将现有 Fal 数据转换到通用模板判定，不破坏现有接口 |
| 发现同步 | `packages/server/src/engine/catalog/match-after-discover.ts` | 写入模板候选，不把候选直接应用为执行合同 |
| 参数执行 | `packages/server/src/engine/param-mapper.ts`、`packages/server/src/routes/router.ts` | 应用选中的模板、变体覆盖并交给适配器 |
| 管理 API | `packages/server/src/routes/admin/models.ts`、`packages/server/src/routes/admin/variants.ts` | 查询模板、应用模板、保存变体选择 |
| 管理 UI | `packages/web/src/pages/Models.tsx`、`packages/web/src/pages/Variants.tsx`、`packages/web/src/pages/Wizard.tsx` | 显示来源、证据、字段、冲突和可覆盖限制 |
| 测试 | `packages/catalog/test-parameter-template.ts`、`packages/server/test-parameter-template.ts`、`packages/server/test-schema-template-compatibility.ts` | 提取、匹配、映射、冲突、变体和运行时门禁回归 |
| 记录 | `docs/OPEN-GENERATIVE-AI-TEMPLATE-EVIDENCE.md`、`NOTICE.md` | 来源提交、字段统计、许可和限制 |

---

## 4. 分阶段执行任务

### Task 0：备份并冻结基线

**Files:**
- Create: `backups/open-generative-ai-template-YYYYMMDD-HHmmss/`
- Modify: `docs/OPEN-GENERATIVE-AI-TEMPLATE-EVIDENCE.md`

- [ ] 记录工作树状态、当前分支、Node 版本和 pnpm 版本。
- [ ] 使用现有数据库备份脚本创建数据库备份，不覆盖既有备份。
- [ ] 备份本任务第一批将修改的 Schema、匹配器、参数映射、管理 API 和 UI 文件。
- [ ] 记录源仓库提交号：

```powershell
$source = 'E:\code\openhub\Open-Generative-AI'
git -C $source rev-parse HEAD
git -C $source status --short
```

**验收：** 备份可读，源仓库提交号已写入证据文档，未覆盖当前工作树其他未提交修改。

### Task 1：生成可复现的模板二快照

**Files:**
- Create: `packages/catalog/tools/import-open-generative-ai.ts`
- Create: `packages/catalog/data/open-generative-ai.snapshot.json`
- Modify: `packages/catalog/package.json`
- Modify: `packages/catalog/src/index.ts`
- Test: `packages/catalog/test-parameter-template.ts`

**Interfaces:**
- Produces `OpenGenerativeAiSnapshot` with `sourceCommit`, `sourceFileSha256`, `generatedAt`, `records` and `sourceLicense`.
- Produces normalized records with `sourceModelId`, `sourceCollection`, `sourceIndex`, `operation`, `modality`, `provider`, `providerName`, `endpointHint`, `inputs`, `required`, and `provenance`.

- [ ] 让脚本接收 `--source` 和 `--out`，默认值分别为 `E:\code\openhub\Open-Generative-AI` 与 `packages/catalog/data/open-generative-ai.snapshot.json`。
- [ ] 只读取 `packages/studio/src/models.js` 导出的八个模型数组；数组缺失、记录不是对象、`id`/`inputs` 类型错误时直接退出并报告错误。
- [ ] 将 `int` 统一为 `integer`，将 `minValue`/`maxValue` 规范化为 `minimum`/`maximum`，将 `max_items` 规范化为 `maxItems`，保留原始输入字段名。
- [ ] 保留枚举、默认值、步长、数组 `items`、对象 `properties`、`required`、描述、示例和未知扩展字段；不能静默删除参数信息。
- [ ] 仅把源 `endpoint` 保存为 `endpointHint`，不生成 OpenHub 请求路径。
- [ ] 写入源提交号、源文件 SHA256、数组名、数组索引和快照 SHA256。
- [ ] 保证同一源提交重复生成的快照除 `generatedAt` 外内容稳定；哈希计算排除生成时间。

```typescript
export interface OpenGenerativeAiSnapshot {
  source: "open-generative-ai";
  sourceCommit: string;
  sourceFileSha256: string;
  sourceLicense: string | null;
  records: NormalizedParameterTemplate[];
  snapshotSha256: string;
}

export interface NormalizedParameterTemplate {
  sourceModelId: string;
  sourceCollection: string;
  sourceIndex: number;
  operation: string;
  modality: "image" | "video" | "audio";
  provider: string | null;
  providerName: string | null;
  endpointHint: string | null;
  inputs: Record<string, ParameterField>;
  required: string[];
  provenance: { sourceCommit: string; file: string; collection: string; index: number };
}
```

- [ ] 用当前源仓库生成快照，并断言八组记录总数为 439、输入字段去重后为 128。
- [ ] 不把 `models_dump.json` 导入为第二份重复数据源。

**验收命令：**

```powershell
E:\code\openhub\worktrees\memefast-connector\.runtime\node22\node.exe node_modules\tsx\dist\cli.mjs packages/catalog/tools/import-open-generative-ai.ts --source E:\code\openhub\Open-Generative-AI --out packages/catalog/data/open-generative-ai.snapshot.json
E:\code\openhub\worktrees\memefast-connector\.runtime\node22\node.exe node_modules\tsx\dist\cli.mjs --test packages/catalog/test-parameter-template.ts
```

### Task 2：增加多来源模板存储

**Files:**
- Create: `packages/server/src/db/schema/model-parameter-templates.ts`
- Create: `packages/server/drizzle/0011_model_parameter_templates.sql`
- Modify: `packages/server/src/db/schema/index.ts`
- Modify: `packages/server/src/db/schema/variants.ts`
- Test: `packages/server/test-parameter-template.ts`

- [ ] 新建 `model_parameter_templates` 表，至少保存 `modelId`、`source`、`sourceModelId`、`sourceCollection`、`operation`、`modality`、`templateSnapshot`、`fieldMapping`、`matchStatus`、`matchConfidence`、`matchReason`、`sourceCommit`、`sourceFileSha256`、`snapshotSha256`、`syncedAt`、`createdAt` 和 `updatedAt`。
- [ ] 使用唯一键 `(model_id, source, source_model_id, operation)`，保证重复同步是更新而不是重复插入。
- [ ] `source` 至少支持 `fal_schema` 和 `open_generative_ai`；不把 Fal 专用旧列直接改名覆盖。
- [ ] 给 `variants` 增加可空 `parameter_template_id` 外键；为空时保持现有行为。
- [ ] 将模板状态和运行时状态分开：数据库中的 `applied` 不能直接写入模型 `executionStatus=ready`。
- [ ] 将源仓库提交号和快照哈希写入表，支持后续判断旧模板是否过期。

```sql
CREATE TABLE model_parameter_templates (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_model_id TEXT NOT NULL,
  source_collection TEXT NOT NULL,
  operation TEXT NOT NULL,
  modality TEXT NOT NULL,
  template_snapshot TEXT NOT NULL,
  field_mapping TEXT,
  match_status TEXT NOT NULL,
  match_confidence TEXT NOT NULL,
  match_reason TEXT,
  source_commit TEXT,
  source_file_sha256 TEXT,
  snapshot_sha256 TEXT,
  synced_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(model_id, source, source_model_id, operation)
);
```

- [ ] 执行迁移并验证旧模型、旧 Fal 字段和既有变体仍可读取。

### Task 3：导入、匹配和兼容性判定

**Files:**
- Create: `packages/server/src/engine/catalog/parameter-template-matcher.ts`
- Modify: `packages/server/src/engine/catalog/schema-matcher.ts`
- Modify: `packages/server/src/engine/catalog/match-after-discover.ts`
- Modify: `packages/server/src/routes/admin/models.ts`
- Test: `packages/server/test-parameter-template.ts`
- Test: `packages/server/test-schema-template-compatibility.ts`

- [ ] 将当前 Fal Schema 的参数结构转换为同一套规范化模板输入，保留现有 Fal API 返回字段。
- [ ] 将快照记录按 `sourceModelId`、规范化名称、厂商、家族、版本、模态和操作调用现有模型匹配器；禁止新增逐模型硬编码别名。
- [ ] 精确 ID 或可信 Catalog 组合只能产生高置信候选；只有管理员确认且适配器绑定、模态、操作、必填字段映射均通过后才允许 `confirmed/applied`。
- [ ] 仅共享厂商词、模态词或模糊相似度的记录保持 `candidate`，不能自动应用。
- [ ] 统一兼容性函数返回 `requiredFields`、`fieldMapping`、`unsupportedFields`、`unmappedRequiredFields`、`overridableFields` 和 `reasons`。
- [ ] 当 Fal 与模板二都存在时分别保存；同一模型同一操作的字段或限制冲突标记为 `conflict`，不静默合并。
- [ ] `endpointHint` 永远不参与真实路由；真实路由只使用 `adapterId`、适配器 manifest 和站点配置。

```typescript
export function evaluateParameterTemplateCompatibility(input: {
  model: ModelRow;
  template: NormalizedParameterTemplate;
  registration: AdapterRegistration | null;
  operation: string;
  templateConfirmed: boolean;
}): ParameterTemplateCompatibility;
```

- [ ] 为 `t2v`、`i2v`、`v2v`、lipsync、recast 分别保存操作；不能因为都是视频而共用一套必填字段。
- [ ] 对 `audioModels` 先保留源操作和候选字段；只有适配器明确声明时才映射到 `audio.speech` 或其他 OpenHub 能力。

### Task 4：让模板参与参数和变体，而不污染执行层

**Files:**
- Modify: `packages/server/src/engine/param-mapper.ts`
- Modify: `packages/server/src/routes/router.ts`
- Modify: `packages/server/src/routes/admin/variants.ts`
- Modify: `packages/server/src/engine/tasks/worker.ts`
- Test: `packages/server/test-param-mapper.ts`
- Test: `packages/server/test-parameter-template.ts`

- [ ] 请求合并顺序固定为：选中模板默认值 → 模型已确认约束 → 变体默认值 → 变体覆盖 → 请求值 → 变体阻断字段。
- [ ] 只把已声明映射的字段转换到适配器请求；`endpointHint`、源 UI 字段和未映射私有字段不得直接发送。
- [ ] 允许变体在已知边界内改变 `aspect_ratio`、`resolution`、`duration`、`image_urls`、`video_urls`、`audio_urls` 的数量；超出模型/适配器上限才拒绝。
- [ ] 嵌套数组/对象参数使用现有 Zod/参数校验路径，不为每个源模型新增控制器。
- [ ] 模板应用后仍执行现有 `requiredCapability` 运行时探测；没有当前 `available` 探测时继续返回 `409 capability_unverified`。
- [ ] 任务 Worker 使用变体选择的模板完成参数合并，但提交和查询仍分别通过 `video.submit` 与 `video.query` 适配器能力。

```typescript
export function applyParameterTemplate(
  template: NormalizedParameterTemplate,
  variant: Variant,
  request: Record<string, unknown>,
): Record<string, unknown>;
```

- [ ] 增加回归测试：模板二存在不能让模型自动变成 `ready`；支持的参考媒体数量变化可以通过；未知字段和超限值被结构化拒绝。

### Task 5：管理 API 和页面显示真实来源

**Files:**
- Modify: `packages/server/src/routes/admin/models.ts`
- Modify: `packages/server/src/routes/admin/variants.ts`
- Modify: `packages/server/src/routes/admin/wizard.ts`
- Modify: `packages/web/src/pages/Models.tsx`
- Modify: `packages/web/src/pages/Variants.tsx`
- Modify: `packages/web/src/pages/Wizard.tsx`
- Test: `packages/server/test-parameter-template.ts`

- [ ] 增加按模型查询模板列表的管理接口，返回来源、操作、匹配状态、置信度、字段数量、必填未映射字段、限制和证据。
- [ ] 增加显式应用模板接口；应用前重新执行兼容性检查，失败时不写入 `parameter_template_id`。
- [ ] 变体编辑接口支持选择模板，并在保存时验证模板属于当前模型且状态不是 `incompatible`。
- [ ] 模型页将 `Fal Schema` 与 `Open-Generative-AI` 分开展示，不再只显示一个“Schema 匹配”。
- [ ] 变体页显示模板来源和可覆盖字段，允许用户修改比例、分辨率、时长、参考数量；若超限，显示具体边界和证据。
- [ ] 向导中展示字段预览、映射目标、未映射字段和冲突原因；用户没有明确点击应用时只保存候选。
- [ ] 页面不得把 `applied`、`confirmed` 或 `catalog matched` 文案写成“已可调用”；运行状态单独显示。

### Task 6：全量验证、文档和发布边界

**Files:**
- Create: `docs/OPEN-GENERATIVE-AI-TEMPLATE-EVIDENCE.md`
- Modify: `docs/ADAPTER-SDK.md`
- Modify: `docs/MULTIMODAL-PROVIDER-EVIDENCE.md`
- Modify: `NOTICE.md`
- Modify: `COMPLETION_STATUS.md`
- Test: `packages/catalog/test-parameter-template.ts`
- Test: `packages/server/test-parameter-template.ts`

- [ ] 运行源快照导入测试并核验 439 条记录、128 个输入字段、稳定哈希和重复同步幂等。
- [ ] 运行服务端全量测试、MemeFast 测试、类型检查、Web 构建和适配器索引检查。
- [ ] 重建可靠性矩阵，确认模板二增加的是参数模板覆盖，不会增加未经探测的 `executable` 数量。
- [ ] 使用本地临时端口验证：模板已应用但能力探测缺失时仍返回 `409 capability_unverified`，并且没有上游请求。
- [ ] 使用本地 fixture 验证至少四类模板：图片基础参数、视频时长/比例/参考媒体、音频嵌套对象、数组对象参数。
- [ ] 不执行真实计费的视频创建/查询；如后续获得明确授权，单独记录供应商、模型、费用上限、提交响应、查询响应和结果 URL。
- [ ] 记录当前源仓库提交号、许可、统计、已知不兼容和未验证假设；不把源仓库的 MuAPI endpoint 当作 OpenHub 适配器。

**验收标准：**

1. Fal Schema 和 Open-Generative-AI 模板能够并存、分别展示、显式选择。
2. 模板二可以补全参数表单和变体限制，但不伪造供应商执行协议。
3. 用户可以在已验证边界内修改比例、分辨率、时长和参考媒体数量。
4. 未映射参数可见、可解释、不可静默丢失。
5. 模板应用不会绕过运行时能力探测；没有真实能力证据的模型仍不能调用。
6. 源数据更新可复现、可审计、可回滚，不依赖运行时加载外部仓库。

---

## 5. 计划自检结论

- **覆盖性：** 已覆盖源数据提取、规范化、多来源存储、匹配、参数映射、变体、管理端、测试和文档。
- **边界：** 明确区分参数模板与供应商适配器，避免把 MuAPI 的 `endpoint` 误当成 MemeFast/Fal 的执行路径。
- **维护成本：** 只维护一个版本化快照和一个通用兼容性判定，不为 439 个模型添加硬编码；新增供应商仍通过适配器 manifest 和证据接入。
- **未承诺：** 本计划不会让所有供应商自动接受同一套参数，也不会在没有真实运行探测时把模型标成可用。
- **第一阶段停止条件：** 如果源文件结构变化、许可范围无法确认、快照校验失败或模板与适配器冲突，停止自动应用并保留候选证据，不继续堆补丁。
