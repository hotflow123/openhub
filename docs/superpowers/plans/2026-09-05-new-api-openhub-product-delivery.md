# OpenHub New API 兼容产品推进实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 OpenHub 做成一个可直接集成到第三方网站或软件的 New API 兼容层：用户只提供上游 New API/MemeFast 地址和 Key，OpenHub 自动发现可见模型、正确分类、补全可验证参数、绑定真实协议，并通过 OpenHub 地址和 OpenHub Key 提供统一调用。

**Architecture:** 上游站点是执行入口，OpenHub 不接管 New API 内部 Channel、供应商 Key 或模型映射。OpenHub 保存原始模型名、协议证据和参数模板，通过统一路由、字段映射及异步任务层把第三方请求转换为 New API 可接受的请求。Fal 与 Open-Generative-AI 只提供参数百科和模板参考，不能替代 New API 的真实协议。

**Tech Stack:** TypeScript, Hono, React, SQLite, Drizzle ORM, pnpm, Node.js 22, `node:test`, Vite

## Global Constraints

- 上游 Key 只保存在 OpenHub 站点配置中并加密，第三方只使用 OpenHub Key。
- 下游默认使用 New API 返回的原始模型名；不得把 Fal endpoint、协议 ID 或供应商猜测名改成下游模型名。
- New API 公共协议与供应商原生协议分开；不能因为供应商目录模板存在就假设上游支持该协议。
- Fal/Open-Generative-AI 数据只能在有映射和协议证据时进入真实请求，未知字段不得静默丢弃。
- 不运行外部插件 JavaScript，不允许任意 URL、任意 HTTP 方法或任意脚本作为运行时适配器。
- 生成类创建请求不自动重试；查询、健康检查和回调只允许有限重试。
- 不清空数据库、不覆盖人工 Variant、不执行 `git reset --hard`、`git clean` 或删除用户已有修改。
- 每次源码修改前备份涉及文件；每个阶段先写最小失败测试，再写最小实现。
- 不以“发现模型数量”或“匹配数量”宣称可用；可用性必须由协议、适配器、参数映射和证据状态共同决定。

---

## 1. 当前证据与缺口

当前仓库为 `E:\code\openhub\repo`，已有以下实现：

| 位置 | 当前能力 | 本计划处理方式 |
|---|---|---|
| `packages/server/src/engine/discover.ts` | 调用 `/v1/models`、保存原始模型、推断模态、尝试创建 Variant | 修复未知模态默认成 LLM、接入统一公开资格判断 |
| `packages/server/src/engine/protocol-catalog.ts` | 保存协议记录、绑定模型、检查视频 `submit/query` | 增加协议生命周期和运行时可执行资格校验 |
| `packages/server/src/engine/memefast-protocol-sync.ts` | 从受信任来源导入协议、保存哈希和版本差异 | 保留旧版本，补齐同步报告和启用门禁 |
| `packages/server/src/engine/adapters/openai.ts` | New API 常见 OpenAI 兼容请求 | 作为标准 LLM/图片/音频/Embedding 执行器 |
| `packages/server/src/engine/adapters/memefast.ts` | 标准请求委托给 OpenAI，视频读取显式协议操作 | 改为协议驱动的请求/响应映射，不按关键词挑操作 |
| `packages/server/src/routes/router.ts` | Variant → Model → Site → Adapter 路由，视频有协议门禁 | 补齐公开性、模态、适配器和协议一致性门禁 |
| `packages/server/src/routes/v1/models.ts` | 输出公开 Variant，视频过滤不完整协议 | 与统一公开资格复用同一判断 |
| `packages/server/src/routes/v1/video.ts` | 自定义视频提交、任务查询、回调配套 | 增加第三方易用的 `/v1/videos` 兼容入口并保留旧入口 |
| `packages/server/src/engine/param-mapper.ts` | Variant 覆盖、屏蔽、重命名、未知字段过滤 | 加入协议字段确认，禁止参数无声丢失 |
| `packages/server/src/engine/tasks/service.ts`、`worker.ts` | 任务持久化、轮询、超时、回调 | 保留单任务系统，固定提交不重试、查询可重试 |
| `packages/server/src/db/schema/memefast-protocols.ts` | 协议、绑定、同步运行记录 | 优先复用，只有现有字段无法表达时才迁移 |
| `packages/server/src/lib/open-generative-ai.ts` | Open-Generative-AI 数据读取 | 作为模板来源，不当作供应商执行协议 |

必须先承认的事实：

1. New API 的普通上游 Key 只能看到该 Key 有权限看到的公开模型，不能推断出内部全部 Channel。
2. New API 的 LLM、图片、音频、Embedding 通常复用公共 OpenAI 兼容路径；视频等任务插件可能使用不同协议。
3. “模型已发现”“Catalog 已匹配”“Schema 已关联”“协议已导入”都不等于“下游可以成功调用”。
4. 当前 `discover.ts:223` 在推断失败时默认 `llm`，这是错误分类根因，必须先消除。
5. 当前自动 Variant 创建逻辑只负责插入记录，不能证明其协议、参数和适配器已经可执行。

本计划不承诺“所有模型自动成功”，只承诺建立一条可审计、可扩展、不会伪装可用的真实链路。

## 2. 目标工作流

```text
管理员输入 New API/MemeFast 地址 + 上游 Key
        ↓
OpenHub 加密保存站点凭据
        ↓
调用上游公共 /v1/models
        ↓
保留原始模型名，记录原始元数据和同步时间
        ↓
按明确证据分类：LLM / 图片 / 音频 / 视频 / Embedding / 未知
        ↓
公共协议绑定，或导入并验证任务协议
        ↓
从 Fal/Open-Generative-AI 目录取得参数模板
        ↓
校验模板字段、模型能力和协议字段
        ↓
生成同名可调用 Variant；不合格模型留在后台，不进入公开列表
        ↓
第三方只调用 OpenHub /v1/* + OpenHub Key
        ↓
OpenHub 映射参数并把请求发回 New API
        ↓
同步结果直接返回；视频任务保存、查询、超时并统一返回
```

## 3. 文件职责锁定

### 现有文件

- `packages/server/src/engine/discover.ts`：只负责读取和保存上游模型，不在这里实现协议执行。
- `packages/server/src/engine/publication-policy.ts`：新增，集中计算模型是否可以公开，避免发现、模型列表、路由各自判断。
- `packages/server/src/engine/protocol-catalog.ts`：协议版本、绑定、证据和可执行资格。
- `packages/server/src/engine/memefast-protocol-sync.ts`：受信任来源的导入、哈希、版本和差异。
- `packages/server/src/engine/adapters/openai.ts`：标准 New API 公共协议执行。
- `packages/server/src/engine/adapters/memefast.ts`：站点协议驱动执行；不写每个模型分支。
- `packages/server/src/engine/param-mapper.ts`：统一参数策略和字段映射。
- `packages/server/src/routes/router.ts`：所有公开请求的统一路由门禁。
- `packages/server/src/routes/v1/models.ts`：下游模型公开列表。
- `packages/server/src/routes/v1/video.ts`：异步视频公开入口。
- `packages/server/src/engine/tasks/service.ts`、`packages/server/src/engine/tasks/worker.ts`：唯一异步任务系统。
- `packages/server/src/db/schema/models.ts`、`variants.ts`、`memefast-protocols.ts`：现有模型、Variant、协议数据。

### 新增测试与文档

- `packages/server/src/engine/publication-policy.ts`
- `packages/server/test-publication-policy.ts`
- `packages/server/test-new-api-product.ts`
- `packages/server/test-protocol-request-mapping.ts`
- `docs/superpowers/plans/2026-09-05-new-api-openhub-product-delivery.md`
- `PROJECT_POSITIONING.md`
- `README.md`
- `RUN.md`

不新增第二套模型表、第二套任务表或第二套适配器注册表。

## 4. 执行阶段

### Task 1: 冻结基线并复现“发现但不可调用”

**Files:**
- Create: `packages/server/test-new-api-product.ts`
- Modify: `packages/server/package.json`
- Inspect: `packages/server/src/engine/discover.ts`
- Inspect: `packages/server/src/routes/v1/models.ts`
- Inspect: `packages/server/src/routes/router.ts`

**Interfaces:**
- Test consumes `OPENHUB_URL`, `OPENHUB_KEY`, and optional `OPENHUB_MODEL`.
- Test produces a machine-readable readiness report with counts for models, public Variants, protocols, and callable models.

- [ ] **Step 1: 备份当前基线文件**

```powershell
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backup = "backups/next-stage-before-$stamp"
New-Item -ItemType Directory -Force $backup | Out-Null
Copy-Item packages/server/src/engine/discover.ts $backup
Copy-Item packages/server/src/engine/protocol-catalog.ts $backup
Copy-Item packages/server/src/routes/router.ts $backup
Copy-Item packages/server/src/routes/v1/models.ts $backup
Copy-Item packages/server/src/routes/v1/video.ts $backup
Copy-Item packages/server/src/engine/param-mapper.ts $backup
git status --short
```

- [ ] **Step 2: 记录现有检查结果**

```powershell
pnpm --dir packages/server typecheck
pnpm --dir packages/server test
pnpm --dir packages/web build
```

Expected: 保存命令输出；当前已有测试必须先保持通过。

- [ ] **Step 3: 写入最小黑盒验收脚本**

脚本必须执行以下请求并输出 JSON：

```text
GET {OPENHUB_URL}/health
GET {OPENHUB_URL}/v1/models with Authorization: Bearer {OPENHUB_KEY}
```

脚本必须断言：

```text
health.status == 200
v1/models.status == 200
response.object == "list"
response.data 是数组
```

如果 `OPENHUB_MODEL` 存在，脚本再调用：

```text
POST {OPENHUB_URL}/v1/chat/completions
{
  "model": "{OPENHUB_MODEL}",
  "messages": [{"role":"user","content":"return exactly: openhub-smoke-ok"}],
  "max_tokens": 16
}
```

脚本不得把 Key 写入输出、异常或日志。

- [ ] **Step 4: 运行基线脚本**

```powershell
$env:OPENHUB_URL = "http://localhost:3000"
$env:OPENHUB_KEY = "<existing-openhub-key>"
pnpm --dir packages/server exec tsx test-new-api-product.ts
```

Expected: 明确记录当前是“模型发现成功但无公开 Variant”“公开列表为空”“路由失败”还是“标准调用成功”。

- [ ] **Step 5: 保存基线结果**

将结果写入 `logs/next-stage-baseline-YYYYMMDD.json`，不写入任何 Key、完整 Prompt、媒体内容或上游响应密钥。

### Task 2: 修复模态识别，不再把未知模型伪装成 LLM

**Files:**
- Create: `packages/server/src/engine/publication-policy.ts`
- Create: `packages/server/test-publication-policy.ts`
- Modify: `packages/server/src/db/schema/models.ts`
- Modify: `packages/server/src/engine/discover.ts`
- Modify: `packages/server/package.json`

**Interfaces:**

```ts
export type ModelModality = "llm" | "image" | "audio" | "video" | "embedding" | "unknown";

export interface PublicationInput {
  siteActive: boolean;
  modelStatus: "active" | "degraded" | "offline" | "unknown";
  modality: ModelModality;
  adapterCapabilities: string[];
  protocolReady: boolean;
}

export interface PublicationDecision {
  public: boolean;
  reason:
    | "site_unavailable"
    | "model_unavailable"
    | "unknown_modality"
    | "adapter_capability_missing"
    | "video_protocol_missing"
    | "ready";
}

export function assessPublication(input: PublicationInput): PublicationDecision;
```

- [ ] **Step 1: 写失败测试**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { assessPublication } from "./src/engine/publication-policy";

test("unknown modality is never public", () => {
  assert.deepEqual(
    assessPublication({
      siteActive: true,
      modelStatus: "active",
      modality: "unknown",
      adapterCapabilities: ["chat"],
      protocolReady: false,
    }),
    { public: false, reason: "unknown_modality" },
  );
});

test("video needs both adapter and protocol readiness", () => {
  assert.equal(
    assessPublication({
      siteActive: true,
      modelStatus: "active",
      modality: "video",
      adapterCapabilities: ["video.submit", "video.query"],
      protocolReady: false,
    }).public,
    false,
  );
});

test("standard LLM is public when the standard adapter exists", () => {
  assert.deepEqual(
    assessPublication({
      siteActive: true,
      modelStatus: "active",
      modality: "llm",
      adapterCapabilities: ["chat"],
      protocolReady: false,
    }),
    { public: true, reason: "ready" },
  );
});
```

- [ ] **Step 2: 运行测试确认失败**

```powershell
pnpm --dir packages/server exec tsx --test test-publication-policy.ts
```

Expected: FAIL，因为 `publication-policy.ts` 尚未实现。

- [ ] **Step 3: 实现统一公开资格判断**

实现规则：

```text
site 非 active               → 不公开
model 非 active              → 不公开
modality unknown             → 不公开
llm + chat                  → 可公开
embedding + embedding       → 可公开
image + image.generation    → 可公开
audio + audio.speech/transcription → 可公开
video + video.submit/query + protocolReady → 可公开
其他                         → 不公开
```

- [ ] **Step 4: 将模型模态增加 `unknown`**

修改 `packages/server/src/db/schema/models.ts` 的模态类型，使无法确认的模型有合法存储值。若 SQLite 当前列没有 CHECK 约束，只更新类型和读写路径；若迁移检查发现存在约束，再生成单独迁移，不重建模型表。

- [ ] **Step 5: 删除发现阶段的 LLM 默认值**

将 `packages/server/src/engine/discover.ts:221-224` 的逻辑从：

```ts
let modality = inferRuntimeModality(effectiveModel) ?? "llm";
```

改为：

```ts
let modality = inferRuntimeModality(effectiveModel) ?? "unknown";
```

所有依赖模态的能力字段在 `unknown` 时保持空值或空数组，不填充 LLM 参数。

- [ ] **Step 6: 运行测试确认通过**

```powershell
pnpm --dir packages/server exec tsx --test test-publication-policy.ts
pnpm --dir packages/server typecheck
```

Expected: 测试通过，未确认模态不再变成 LLM。

### Task 3: 自动创建“合格 Variant”，保护人工配置

**Files:**
- Modify: `packages/server/src/engine/discover.ts`
- Modify: `packages/server/src/engine/publication-policy.ts`
- Modify: `packages/server/src/routes/v1/models.ts`
- Modify: `packages/server/src/routes/router.ts`
- Modify: `packages/server/test-new-api-product.ts`

**Interfaces:**
- `discoverModels()` continues returning discovery counts.
- `ensureAutoVariant(model)` creates or updates only an auto-created Variant.
- `assessPublication()` is the only shared publication decision.

- [ ] **Step 1: 写自动公开资格回归测试**

测试输入至少包含：

```text
active New API site
LLM with chat adapter
video with complete submit/query protocol
video with only submit
unknown modality
```

断言：

```text
LLM Variant isPublic == 1
complete video Variant isPublic == 1
incomplete video Variant isPublic == 0
unknown Variant isPublic == 0
```

- [ ] **Step 2: 修改自动 Variant 逻辑**

`ensureAutoVariant` 必须读取完整 Model 行并执行 `assessPublication()`：

```text
不存在 Variant → 仅创建一条自动 Variant
存在自动 Variant → 只更新 isPublic 和更新时间
存在人工 Variant → 不覆盖名称、参数、映射、限制或可见性
不合格模型 → 保留 Variant，但 isPublic == 0
```

自动 Variant 的名称固定为 `model.rawName`，不得加供应商前缀或协议前缀。

- [ ] **Step 3: 修复站点重新发现**

重新发现时：

```text
仍在上游列表中的模型 → 更新元数据和自动 Variant 资格
不在最新列表中的模型 → model.status = "offline"，自动 Variant 不再公开
人工 Variant → 保留记录，路由时由站点和模型状态决定
```

- [ ] **Step 4: 让公开列表复用同一资格判断**

`packages/server/src/routes/v1/models.ts` 不再自己重复实现视频过滤；读取 Model、Site、协议和 Adapter 后调用 `assessPublication()`。列表只返回：

```text
variant.isPublic == 1
hub key 有权限
site active
model active
publication.public == true
```

- [ ] **Step 5: 运行回归检查**

```powershell
pnpm --dir packages/server exec tsx --test test-publication-policy.ts
pnpm --dir packages/server typecheck
pnpm --dir packages/server test
```

Expected: 发现成功后，标准模型不再因没有手工 Variant 而全部消失；不合格视频仍不进入公开列表。

### Task 4: 修复外部路由门禁与原始模型名语义

**Files:**
- Modify: `packages/server/src/routes/router.ts`
- Modify: `packages/server/src/routes/v1/models.ts`
- Modify: `packages/server/src/engine/discover.ts`
- Modify: `packages/server/src/routes/v1/chat.ts`
- Modify: `packages/server/src/routes/v1/images.ts`
- Modify: `packages/server/src/routes/v1/audio.ts`
- Modify: `packages/server/src/routes/v1/embeddings.ts`
- Modify: `packages/server/src/routes/v1/video.ts`

**Interfaces:**

```text
下游请求 model = variant.name
发往 New API 的 model = model.rawName
返回响应 model = 下游请求的 variant.name
```

- [ ] **Step 1: 写路由安全测试**

测试断言：

```text
不存在 Variant → 404 variant_not_found
存在但 isPublic == 0 的 Variant → 404 或 403，不得转发
site 非 active → 503 site_unavailable
LLM 使用 model.rawName 发往上游
Fal endpoint 不得出现在上游 model 字段
```

- [ ] **Step 2: 区分外部解析和内部任务解析**

```text
resolveRoute(name)       → 面向下游，必须检查 isPublic
resolveRouteById(id)     → 仅供已创建任务恢复，检查站点、适配器和协议，不因公开性变化丢失任务
```

这样管理员隐藏模型不会被新请求调用，但已提交任务仍能完成或明确失败。

- [ ] **Step 3: 固定公共 New API 路径**

标准模态使用：

```text
LLM          → POST /v1/chat/completions
Embedding    → POST /v1/embeddings
图片生成     → POST /v1/images/generations
图片编辑     → POST /v1/images/edits
图片变体     → POST /v1/images/variations
音频语音     → POST /v1/audio/speech
音频转写     → POST /v1/audio/transcriptions
```

这些路径不需要按每个模型猜供应商协议。

- [ ] **Step 4: 运行路由测试**

```powershell
pnpm --dir packages/server typecheck
pnpm --dir packages/server test
```

### Task 5: 将协议同步变成“版本化、可回退、不可伪装”的目录

**Files:**
- Modify: `packages/server/src/engine/memefast-protocol-sync.ts`
- Modify: `packages/server/src/engine/protocol-catalog.ts`
- Modify: `packages/server/src/routes/admin/memefast-protocols.ts`
- Modify: `packages/server/src/db/schema/memefast-protocols.ts` only if existing fields are insufficient
- Modify: `MEMEFAST-PROTOCOL-INVENTORY.md`
- Test: `packages/server/test-memefast-protocol.ts`

**Interfaces:**

```text
protocol_catalog:
  protocolId + version + contentHash = immutable identity
  status = imported | active | changed | deprecated
  enabled = runtime publication gate

model_protocol_bindings:
  modelId + protocolRecordId
  evidenceStatus = documented | imported | fixture_verified | runtime_verified | enabled
```

- [ ] **Step 1: 保留现有同步安全测试**

```powershell
pnpm --dir packages/server exec tsx --test test-memefast-protocol.ts
```

Expected: 当前版本、哈希、失败不覆盖旧记录、HTML 不猜协议等测试继续通过。

- [ ] **Step 2: 定义导入状态**

```text
文档页面找到                 → documented/imported
请求响应结构可由 Fixture 解析 → fixture_verified
协议实现完成且能执行          → enabled
真实请求完成                  → runtime_verified
文档内容变化                 → 新版本 changed，旧版本保留
文档声明废弃                 → deprecated，旧绑定不删除
```

`documented` 或 `imported` 不能直接使模型公开。

- [ ] **Step 3: 增加协议启用检查**

新增纯函数或现有函数扩展：

```ts
export function canEnableProtocol(input: {
  recordStatus: "imported" | "active" | "changed" | "deprecated";
  enabled: boolean;
  evidenceStatus: "documented" | "imported" | "fixture_verified" | "runtime_verified" | "enabled";
  adapterCapabilities: string[];
  requiredOperations: string[];
}): boolean;
```

规则：

```text
deprecated → false
required operation 缺失 → false
Adapter 不支持所需 operation → false
只有 documented/imported → false
fixture_verified/runtime_verified/enabled + 结构完整 → true
```

- [ ] **Step 4: 增加管理员可重复同步结果**

`POST /admin/memefast/protocols/sync` 返回：

```json
{
  "added": 0,
  "changed": 0,
  "deprecated": 0,
  "unparsed": 0,
  "failed": 0,
  "bindings": {
    "bound": 0,
    "updated": 0,
    "unmatched": 0
  }
}
```

同步失败时必须保留上一版协议和模型绑定。

- [ ] **Step 5: 增加新旧版本回归测试**

测试：

```text
同一 protocolId 内容不变 → 不新增重复记录
内容变化 → 新版本新增，旧版本仍可查询
新版本解析失败 → 旧版本仍可使用
废弃版本 → 不删除绑定，只禁止新公开
```

- [ ] **Step 6: 运行协议测试**

```powershell
pnpm --dir packages/server exec tsx --test test-memefast-protocol.ts
pnpm --dir packages/server typecheck
```

### Task 6: 让参数模板真正参与请求，而不是只显示

**Files:**
- Create: `packages/server/test-protocol-request-mapping.ts`
- Modify: `packages/server/src/engine/param-mapper.ts`
- Modify: `packages/server/src/engine/adapters/memefast.ts`
- Modify: `packages/server/src/routes/router.ts`
- Inspect: `packages/server/src/lib/open-generative-ai.ts`
- Inspect: `Open-Generative-AI/`

**Interfaces:**

```ts
export interface ProtocolRequestMapping {
  sourceField: string;
  targetField: string;
  transform?: "identity" | "ratio_to_aspect_ratio" | "prompt_to_text_content";
  required?: boolean;
}

export interface ProtocolRequestResult {
  body: Record<string, unknown>;
  unmapped: string[];
  missingRequired: string[];
}
```

- [ ] **Step 1: 写失败映射测试**

使用通用协议 Fixture，不写死某个模型：

```ts
const protocol = {
  protocolId: "fixture.video",
  version: "1",
  modality: "video",
  operations: [
    {
      operationRole: "video.submit",
      method: "POST",
      path: "/v1/video/generations",
      requestBody: {
        schema: {
          properties: {
            model: { type: "string" },
            duration: { type: "integer" },
            ratio: { type: "string" },
            resolution: { type: "string" },
            content: { type: "array" },
          },
        },
      },
    },
  ],
};

const input = {
  model: "seedance2.0",
  prompt: "a red bicycle",
  duration: 5,
  ratio: "16:9",
  resolution: "1080p",
  reference_image_urls: ["https://example.test/a.png"],
};
```

断言请求构造后：

```text
model 保持 seedance2.0
duration 保持 5
ratio 保持 16:9
resolution 保持 1080p
prompt 转成 content[{type:"text",text:"a red bicycle"}]（仅当协议声明 content）
reference_image_urls 不被静默删除
未声明且未显式映射的字段进入 unmapped/error
```

- [ ] **Step 2: 运行测试确认当前行为不足**

```powershell
pnpm --dir packages/server exec tsx --test test-protocol-request-mapping.ts
```

Expected: 当前实现至少在复杂嵌套字段、必填字段或未知字段报告上失败。

- [ ] **Step 3: 复用现有参数管线**

保持既有顺序：

```text
模型能力校验
→ param_blocked
→ 默认值
→ param_overrides
→ fixedParams
→ field_mapping
→ 值转换
→ 协议字段校验
→ 请求构造
```

不新增第二套参数覆盖逻辑。

- [ ] **Step 4: 只实现明确映射**

允许：

```text
OpenHub 标准字段 → 协议声明字段
显式 field_mapping → 目标字段
协议声明的 prompt/content 结构转换
协议声明的枚举和值转换
```

不允许：

```text
根据模型名字猜 targetField
把 Fal endpoint 当作上游 model
把所有未知字段直接透传
不提示就删除用户传入字段
```

- [ ] **Step 5: 处理合法变体**

对图片、视频、音频模板，以下字段只要协议和模型能力声明允许，就必须可修改：

```text
比例
分辨率
时长
参考图片数量
参考视频数量
参考音频数量
```

超出模型真实限制时返回包含字段名、限制值和来源的结构化错误；不能用“模板不是原生模板”作为拒绝理由。

- [ ] **Step 6: 运行映射测试**

```powershell
pnpm --dir packages/server exec tsx --test test-protocol-request-mapping.ts
pnpm --dir packages/server test
pnpm --dir packages/server typecheck
```

### Task 7: 完成视频统一入口和异步生命周期

**Files:**
- Modify: `packages/server/src/routes/v1/video.ts`
- Modify: `packages/server/src/engine/adapters/memefast.ts`
- Modify: `packages/server/src/engine/tasks/service.ts`
- Modify: `packages/server/src/engine/tasks/worker.ts`
- Modify: `packages/server/src/index.ts`
- Test: `packages/server/test-memefast-adapter.ts`

**Interfaces:**

```text
POST /v1/videos
GET  /v1/videos/:id
GET  /v1/videos/:id/content
```

保留兼容入口：

```text
POST /v1/video/generations
GET  /v1/video/tasks/:id
GET  /v1/video/tasks
```

- [ ] **Step 1: 写视频状态机测试**

至少覆盖：

```text
pending → processing
processing → processing
processing → completed + result
processing → failed + error
processing 超过 maxPollingAt → timeout
```

- [ ] **Step 2: 固定提交和查询规则**

```text
创建任务成功 → 保存 siteTaskId
创建任务网络超时 → 标记当前 OpenHub 任务失败，不自动重复创建
查询网络失败 → 保留 processing，下一轮有限重试
查询返回终态 → 保存统一结果
回调失败 → 只重试通知，不重复创建上游任务
```

- [ ] **Step 3: 实现 `/v1/videos`**

创建响应统一为：

```json
{
  "id": "task_xxx",
  "object": "video",
  "status": "queued",
  "model": "上游原始模型名",
  "created_at": 0
}
```

查询响应统一为：

```json
{
  "id": "task_xxx",
  "object": "video",
  "status": "queued|in_progress|completed|failed|expired",
  "model": "下游请求模型名",
  "output": {
    "video_url": "..."
  },
  "error": null
}
```

- [ ] **Step 4: 实现产物读取**

`GET /v1/videos/:id/content` 仅允许任务创建 Key 访问；任务完成且结果 URL 存在时返回受控下载响应。结果过期时返回结构化 `result_expired`，不暴露站点 Key。

- [ ] **Step 5: 运行任务测试**

```powershell
pnpm --dir packages/server exec tsx --test test-memefast-adapter.ts
pnpm --dir packages/server test
pnpm --dir packages/server typecheck
```

### Task 8: 吸收 New API 主源码和插件元数据，但不运行插件源码

**Files:**
- Create: `packages/server/src/lib/new-api-compatibility.ts`
- Modify: `packages/server/src/engine/protocol-catalog.ts`
- Modify: `packages/server/src/engine/memefast-protocol-sync.ts`
- Inspect: `new-api/model/channel.go`
- Inspect: `new-api/controller/model.go`
- Inspect: `new-api/controller/channel_upstream_update.go`
- Inspect: `new-api/relay/helper/model_mapped.go`
- Inspect: `new-api/pkg/jsplugin/registry.go`
- Inspect: `new-api/pkg/jsplugin/routing.go`
- Inspect: `new-api/middleware/task_plugin.go`
- Inspect: `new-api/relay/channel/task/jsplugin/adaptor.go`
- Inspect: `new-api-plugins/index.json`

**Interfaces:**

```ts
export interface NewApiCompatibilityFacts {
  publicModelId: string;
  publicProtocol: "chat.completions" | "responses" | "embeddings" | "images" | "audio" | "task";
  channelType?: string;
  pluginKey?: string;
  pluginVersion?: string;
  modelMappingIsUpstreamOwned: boolean;
}
```

- [ ] **Step 1: 记录 New API 字段语义**

必须形成测试可用的映射：

```text
New API public model ID → models.rawName
New API Channel Type     → 协议证据元数据
New API ModelMapping     → 不在 OpenHub 中重做
New API ParamOverride     → 上游站点行为，不冒充 OpenHub 模板
Plugin routes/protocols   → 受审查的协议证据
Plugin JavaScript         → 禁止运行
```

- [ ] **Step 2: 导入插件元数据**

仅保存：

```text
plugin key
version
models
channelTypes
routes
protocols
allowed hosts
usage schema
内容哈希
```

缺少 OpenHub 受审查实现的协议必须标记为未实现，不能因为 `index.json` 有记录就公开。

- [ ] **Step 3: 固定模型名发送规则**

无论 Catalog 或插件候选指向什么 endpoint，发往 New API 的 `model` 必须是 `models.rawName`。供应商真实模型映射由 New API 内部负责。

- [ ] **Step 4: 运行兼容性检查**

```powershell
pnpm --dir packages/server typecheck
pnpm --dir packages/server test
```

### Task 9: 完成四类模态的第三方集成验收

**Files:**
- Modify: `packages/server/test-new-api-product.ts`
- Modify: `README.md`
- Modify: `RUN.md`
- Modify: `PROJECT_POSITIONING.md`
- Modify: `packages/server/src/index.ts`

**Interfaces:**

```text
OPENHUB_URL
OPENHUB_KEY
OPENHUB_LLM_MODEL
OPENHUB_IMAGE_MODEL
OPENHUB_AUDIO_MODEL
OPENHUB_VIDEO_MODEL
```

- [ ] **Step 1: 验证 `/v1/models`**

```powershell
$env:OPENHUB_URL = "http://localhost:3000"
$env:OPENHUB_KEY = "<existing-openhub-key>"
pnpm --dir packages/server exec tsx test-new-api-product.ts
```

断言：

```text
返回原始模型名
返回列表不包含 isPublic == 0 的模型
返回列表不包含未知模态模型
不返回上游 Key
```

- [ ] **Step 2: 验证 LLM**

调用 `/v1/chat/completions`，确认：

```text
下游使用 OpenHub Key
model 使用公开原始名
上游收到同一个原始 model
普通请求和 stream 请求都能返回
```

- [ ] **Step 3: 验证图片**

调用 `/v1/images/generations`，使用低成本或测试模型，确认：

```text
prompt、size、quality 等字段经过映射
响应为统一 image data
上游失败返回 502/upstream_error，不泄露凭据
```

- [ ] **Step 4: 验证音频**

按可用模型选择 `/v1/audio/speech` 或 `/v1/audio/transcriptions`，确认：

```text
JSON 或 multipart 请求格式正确
二进制响应 Content-Type 正确
转写响应保持统一 JSON
```

- [ ] **Step 5: 验证视频**

只选择一个低成本、已具备完整 `submit/query` 协议的真实模型，确认：

```text
POST /v1/videos 返回 OpenHub task id
OpenHub 只提交一次上游任务
GET /v1/videos/:id 能看到状态变化
成功时返回 video_url 或 /content 可读取
失败时有明确上游错误
超时不会无限轮询
```

- [ ] **Step 6: 验证浏览器集成**

`packages/server/src/index.ts` 的 CORS 只允许配置的来源：

```powershell
$env:OPENHUB_CORS_ORIGIN = "http://localhost:5173"
```

浏览器或第三方网站只能使用 OpenHub Key；不得把 MemeFast Key 注入前端。

### Task 10: 更新产品边界和完成状态

**Files:**
- Modify: `PROJECT_POSITIONING.md`
- Modify: `README.md`
- Modify: `RUN.md`
- Modify: `COMPLETION_STATUS.md`
- Modify: `MEMEFAST-PROTOCOL-INVENTORY.md`

- [ ] **Step 1: 删除高估表述**

删除或改写以下不可证实表述：

```text
所有模型 100% 完成
所有视频供应商即插即用
所有参数自动兼容
只要 Catalog 匹配就能执行
```

- [ ] **Step 2: 写清产品定位**

统一表述为：

> OpenHub 是位于第三方网站/软件与 New API 中转站之间的多模态兼容层。它发现上游 Key 实际可见的模型，保留原始模型名，按证据绑定公共或任务协议，用参数目录补全合法请求，并通过 OpenHub Key 提供统一调用。

- [ ] **Step 3: 写清三种状态**

```text
可发现：上游返回过模型
可执行：协议、适配器、参数映射已齐，但未必真实调用过
已验证：真实调用成功并记录时间、协议版本和模板版本
```

- [ ] **Step 4: 写清边界**

OpenHub 不承诺：

```text
读取普通上游 Key 无法看到的内部 Channel
自动猜出未公开协议
运行第三方插件脚本
把 Fal endpoint 当作 New API 上游模型
对所有计费视频模型批量实测
```

## 5. 最终验收命令

完成全部实现后按以下顺序运行：

```powershell
pnpm install
pnpm --dir packages/server typecheck
pnpm --dir packages/server test
pnpm --dir packages/web build
```

启动服务：

```powershell
pnpm --dir packages/server start
```

另开 PowerShell 执行：

```powershell
$env:OPENHUB_URL = "http://localhost:3000"
$env:OPENHUB_KEY = "<existing-openhub-key>"
pnpm --dir packages/server exec tsx test-new-api-product.ts
```

验收报告必须包含：

```text
站点健康
上游可见模型数量
已分类数量：LLM/图片/音频/视频/Embedding/未知
公开 Variant 数量
可执行协议数量
未实现或不完整协议数量
真实验证模型和结果
```

不得包含：

```text
API Key
完整 Prompt
完整媒体 URL（除非是专门的脱敏测试结果）
上游完整响应中的敏感字段
```

## 6. 完成定义

本轮只有在以下条件同时满足时，才可称为“达到产品 MVP 验收”：

- [ ] 输入一个 New API/MemeFast 地址和上游 Key 后，能够发现该 Key 实际可见的模型。
- [ ] 模型保留原始名称，未确认模态不会被默认标记为 LLM。
- [ ] 标准 LLM、图片、音频、Embedding 至少各有一条公共协议可调用链路。
- [ ] 至少一个真实视频协议具备明确 `submit`、`query`、状态、结果和任务超时链路。
- [ ] 合格模型能够自动生成或更新同名公开 Variant，人工 Variant 不被覆盖。
- [ ] 第三方只需 OpenHub 地址和 OpenHub Key 即可调用。
- [ ] Fal/Open-Generative-AI 参数模板能在有证据的字段上真正进入请求。
- [ ] 比例、分辨率、时长和合法参考媒体数量变体可修改，不会因模板来源被无故拒绝。
- [ ] 不完整、未实现、冲突或未验证协议不会伪装成可调用模型。
- [ ] 协议同步支持版本、哈希、差异、失败保留旧版和新旧绑定共存。
- [ ] 创建类请求没有自动重复提交；查询、回调和健康检查有边界明确的重试。
- [ ] `typecheck`、服务端测试和前端构建全部通过。

## 7. 明确未完成项

以下项目不是本计划隐含承诺，只有拿到真实协议和实现证据后才能继续：

```text
MemeFast 文档未公开的内部接口
New API 插件源码中尚未转写为 OpenHub 实现的协议
没有 submit/query 完整生命周期的视频模型
只有名字、没有公共协议或参数证据的模型
无法由当前上游 Key 访问的隐藏模型
多实例任务队列、分布式锁和高并发调度
```

这些模型继续保留在后台审计清单中，状态明确显示为“待补协议”“未实现”或“未验证”，而不是删除或伪装正常。

## 8. 执行顺序与提交边界

按以下独立阶段推进，每阶段都必须通过自身测试后再进入下一阶段：

```text
PR 1：模态正确性、自动 Variant 和公开列表
PR 2：New API 标准 LLM/图片/音频/Embedding 路由
PR 3：协议目录版本与插件元数据导入
PR 4：协议驱动参数映射和真实模板执行
PR 5：视频统一入口、任务生命周期和第三方验收
PR 6：文档、边界和最终验收报告
```

任何阶段都不得顺手重写整个目录系统、任务系统或所有供应商适配器。
