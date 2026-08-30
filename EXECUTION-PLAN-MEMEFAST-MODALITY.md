# MemeFast 模型分类与能力标记修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` or execute this plan task-by-task with a review checkpoint after each task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 MemeFast 模型发现时的错误分类，使 OpenHub 按真实元数据区分对话、图片、视频、音频、Embedding 和未知模型，并在重新同步时保持人工确认结果。

**Architecture:** 复用现有 `inferModelCapability` 和站点发现流程，不新增通用适配器框架。分类输入优先使用 MemeFast 原生元数据，再使用已确认 Schema、模型目录和严格名称规则；无法确认时写入 `unknown`，不再默认写入 `llm`。将分类来源和置信度持久化，确保目录补全不会覆盖运行时事实或人工覆盖。

**Tech Stack:** TypeScript、现有 MemeFast adapter、Drizzle SQLite、Node `node:test`、React/Vite 管理界面；不新增运行时依赖。

## Global Constraints

- 分类优先级固定为：人工确认 > MemeFast 原生元数据 > 已确认 fal.ai Schema > OpenHub 目录 > 严格名称规则 > `unknown`。
- `model_type` 只有在值明确表示一种类型时才作为决定性证据；`multimodal`、空值和未知值不能直接映射为 `llm`。
- `supported_endpoint_types` 和 `tags` 只增加明确的 `endpointCaps`，不能把目录标签当作已验证的调用合同。
- `Embedding` 独立保存为 `embedding`，不能落入 `llm`。
- 音频证据优先于模型名称中的视频厂商词，确保 `kling-audio` 不被判为视频。
- `unknown` 是诚实的可持久化状态；它可以进入管理界面，但不能自动生成可调用变体。
- 目录补全只有在最终模态为 `llm` 时才能写入上下文、输出上限、推理、函数调用和视觉能力；非 LLM 模型保留这些字段为空或零。
- `capsOverridden=1` 的模型不被重新同步覆盖；人工改动时来源写为 `manual`、置信度写为 `high`。
- 识别模型类型不等于实现对应调用接口；本计划不新增 MemeFast 原生视频任务接口。
- 不修改 API Key，不在日志、测试输出或提交内容中写入任何密钥。
- 不安装 Visual Studio C++ Build Tools，不提交、不推送、不创建 PR。
- 每个任务先运行最小验证，再进入下一个任务；最终使用本地网页 `http://localhost:5173` 验证。

---

## 0. 执行前独立分析

### 已确认事实

| 编号 | 事实 | 证据 |
|---|---|---|
| F1 | 当前真实 MemeFast `/v1/models` 返回 `model_type`、`supported_endpoint_types`、`tags` 等元数据；本次已获取 467 个模型。 | 真实 MemeFast 发现结果 |
| F2 | 当前真实数据统计为：对话 268、音视频 85、图像 47、检索 11、类型缺失 56。 | 真实 MemeFast 发现结果 |
| F3 | `memefast` adapter 已把上游模型原始对象放入 `DiscoveredRemoteModel.metadata`，信息没有在 adapter 层丢失。 | `packages/server/src/engine/adapters/memefast.ts` |
| F4 | `packages/server/src/engine/discover.ts` 当前只把 `m.id` 传给推断函数，并初始化 `modality` 为 `llm`。 | `packages/server/src/engine/discover.ts` |
| F5 | `packages/server/src/engine/infer.ts` 没有 Embedding 分支；`kling` 规则先于音频规则；最终兜底为 `llm`。 | `packages/server/src/engine/infer.ts` |
| F6 | 当前 `models.modality` TypeScript 枚举没有 `unknown`，但设计文档已经把未知能力作为发现阶段的语义。SQLite 实际迁移列是普通 `TEXT`，没有 CHECK 约束。 | `packages/server/src/db/schema/models.ts`、`packages/server/drizzle/0000_quiet_black_knight.sql` |
| F7 | `DESIGN.md` 要求目录是候选建议源、站点运行时信息决定站点实例能力，并明确一个模型可以拥有多个能力标签。 | `DESIGN.md` 第 1、2、5、7 章 |
| F8 | 已存在的站点模型重新发现时，目前只更新状态、适配器和同步时间，不刷新分类与能力字段。 | `packages/server/src/engine/discover.ts` |

### 合理推测

1. 该问题不是外网或 MemeFast 连接失败，而是本地分类流水线忽略了已有元数据。
2. 继续扩大关键词表只能降低部分误判，不能解决多能力模型、类型缺失和重新同步不更新的问题。
3. 将未知模型留给管理员复核，会减少错误调用；代价是少数没有明确元数据的模型不会立即生成可用变体，这是可接受的安全退化。

### 未验证假设

1. MemeFast 全量模型的 `model_type` 取值集合及其大小分布仍需从保存的真实响应中确认，不能凭字段名推测所有值。
2. `supported_endpoint_types` 的每个值是否等价于可直接调用的 OpenAI 路径仍未完全确认，因此只用于能力标记，不直接启用新接口。
3. 目录中的输入输出 modality 对检索模型的表达方式可能与 MemeFast `model_type` 不同，目录只能作为低优先级补全。

### 方案结论

该修复可行，且与前面目标一致：保留 MemeFast 专用连接器，修复“运行时元数据没有进入分类器”的根因；不重写连接器、不复制 MemeFast 全部 API、不把猜测伪装成已支持能力。

## 1. 文件范围

### 修改

- `packages/server/src/engine/infer.ts`：扩展模型分类输入、Embedding/unknown 语义、来源和置信度。
- `packages/server/src/engine/discover.ts`：传入原生元数据，按分类结果写入新模型，并刷新未人工覆盖的已有模型。
- `packages/server/src/engine/catalog/match-after-discover.ts`：让目录只补全低优先级的 `unknown`/关键词分类。
- `packages/server/src/engine/catalog/modality.ts`：复用目录 modality 到 OpenHub modality 的纯转换逻辑。
- `packages/server/src/db/schema/models.ts`：增加 `unknown` 和分类证据字段。
- `packages/server/src/routes/admin/models.ts`：返回分类证据，人工修改时记录 `manual`。
- `packages/server/src/engine/wizard/types.ts`、`packages/server/src/engine/wizard/index.ts`：兼容 `unknown` 的站点模型，但仍只允许管理员确认五种可执行类型。
- `packages/web/src/pages/Models.tsx`：显示分类来源、置信度和待复核状态。
- `packages/server/drizzle/0006_add-model-modality-evidence.sql`：增加分类证据列并安全回填历史数据。
- `packages/server/drizzle/meta/_journal.json`：登记迁移。

### 测试

- `packages/server/test-memefast-modality.ts`：覆盖原生元数据优先级、Embedding、音频优先和 unknown 兜底。
- `packages/server/test-memefast-adapter.ts`：确认 adapter 继续传递原始元数据。
- `packages/server/test-model-contract.ts`：确认 `unknown` 不会被当作可调用能力。

### 不修改

- `packages/memefast` 的 HTTP 传输和标准 Chat/Image/Audio 方法。
- MemeFast 原生视频异步接口。
- fal.ai Schema 同步网络逻辑。
- 其他站点 adapter 的既有分类规则。

## 2. 执行计划

### Task 1：先固定失败用例和分类合同

**Files:**
- Create: `packages/server/test-memefast-modality.ts`
- Modify: `packages/server/test-memefast-adapter.ts`
- Test target: `packages/server/src/engine/infer.ts`

**Interfaces:**
- `inferModelCapability(rawName, options)` 接受 `runtimeMetadata`、可选的已确认 Schema 和目录 modality。
- 返回 `modality`、`endpointCaps`、`paramCaps`、`classificationSource`、`classificationConfidence` 和 `classificationReason`。

- [x] **Step 1: 写入失败测试**

测试至少覆盖以下事实：

```ts
const audio = await inferModelCapability("kling-audio", {
  runtimeMetadata: {
    model_type: "audio",
    supported_endpoint_types: ["audio.speech"],
    tags: ["tts"],
  },
});
assert.equal(audio.modality, "audio");
assert.equal(audio.classificationSource, "runtime");

const embedding = await inferModelCapability("text-embedding-v1", {
  runtimeMetadata: { model_type: "embedding" },
});
assert.equal(embedding.modality, "embedding");
assert.deepEqual(embedding.endpointCaps, ["embedding"]);

const image = await inferModelCapability("provider-image", {
  runtimeMetadata: {
    model_type: "image",
    supported_endpoint_types: ["images.generations"],
  },
});
assert.equal(image.modality, "image");

const video = await inferModelCapability("provider-video", {
  runtimeMetadata: {
    model_type: "video",
    supported_endpoint_types: ["videos.generations"],
  },
});
assert.equal(video.modality, "video");

const unknown = await inferModelCapability("vendor-private-model", {
  runtimeMetadata: { model_type: "future_type", tags: [] },
});
assert.equal(unknown.modality, "unknown");
assert.equal(unknown.classificationSource, "unknown");
```

另加一个冲突用例：`model_type="audio"`、名称包含 `kling` 时仍返回 `audio`；没有任何可识别证据时不能返回 `llm`。

- [x] **Step 2: 运行测试确认失败**

Run:

```powershell
pnpm --filter @openhub/server exec tsx --test test-memefast-modality.ts
```

Expected: FAIL，因为返回类型没有分类来源、Embedding 和 unknown 的完整实现。

### Task 2：实现最小元数据分类器

**Files:**
- Modify: `packages/server/src/engine/infer.ts`

**Interfaces:**

```ts
export type ModelModality =
  | "llm"
  | "image"
  | "audio"
  | "video"
  | "embedding"
  | "unknown";

export type ClassificationSource =
  | "manual"
  | "runtime"
  | "schema"
  | "catalog"
  | "keyword"
  | "unknown";

export interface InferredCapability {
  modality: ModelModality;
  endpointCaps?: string[];
  paramCaps?: string[];
  classificationSource: ClassificationSource;
  classificationConfidence: "high" | "medium" | "low";
  classificationReason: string;
}
```

- [x] **Step 1: 增加原生元数据读取**

从 `runtimeMetadata` 读取并规范化 `model_type`、`supported_endpoint_types`、`tags`、已有 `modality` 和 `capabilities`。非字符串、空字符串和未知值全部忽略；原始对象继续由现有发现流程保存，不在分类器中丢弃。

- [x] **Step 2: 按固定优先级映射类型和 endpoint 能力**

只对测试中确认的明确值建立映射：

```text
embedding / embed / retrieval  -> embedding / embedding
image                         -> image / image_generation
video                         -> video / video_generation
audio / speech / tts / stt    -> audio / tts 或 stt
chat / text / conversation    -> llm / chat
```

Endpoint 和 tag 只产生明确的能力标签：`chat`、`embedding`、`image_generation`、`video_generation`、`tts`、`stt`、`vision`。`vision` 表示输入能力，不把模型主类型改成 `image`。标签去重并保持稳定顺序。

- [x] **Step 3: 修正 Schema、关键词和兜底**

Schema 支持已确认的 `embedding` 类别；名称规则将 `embedding` 和音频规则放在视频规则之前；未知名称返回 `unknown`。删除所有“推断失败默认 llm”的日志和赋值。已有 LLM 强名称规则仍保留，但不为任意未知字符串添加 `chat`。

- [x] **Step 4: 保持非 MemeFast 行为可控**

没有 `runtimeMetadata` 时继续使用现有 Schema/关键词流程；只改变错误的默认值、Embedding 分支和规则顺序。不得把 MemeFast 特有字段解析散落到其他 adapter。

- [x] **Step 5: 运行分类测试**

Run:

```powershell
pnpm --filter @openhub/server exec tsx --test test-memefast-modality.ts
```

Expected: PASS；所有冲突用例的来源和类型符合优先级。

### Task 3：让发现流程使用分类结果并刷新历史模型

**Files:**
- Modify: `packages/server/src/engine/discover.ts`
- Modify: `packages/server/src/engine/adapters/memefast.ts`（仅在类型需要时）

- [x] **Step 1: 把 adapter 元数据传给推断函数**

将现有调用：

```ts
inferModelCapability(m.id, { schemaEndpointId })
```

改为传递 `runtimeMetadata: m.metadata`，并保留“只有 confirmed Schema 才能进入运行时参数提取”的现有约束。

- [x] **Step 2: 用分类结果初始化新模型**

首次发现的模型使用分类器返回的 `modality`、`endpointCaps`、`paramCaps`、来源、置信度和原因。初始值改为 `unknown` 和空能力数组；非空能力必须来自分类器，不得在 `discover.ts` 中再次默认填充 `llm`。

- [x] **Step 3: 刷新未人工覆盖的已有模型**

对 `adapterSource="site"` 且 `capsOverridden=0` 的已有模型更新分类字段和可由同一分类结果确定的能力字段；对 `capsOverridden=1` 的模型只更新同步状态、适配器和时间字段。手工能力不能被新发现结果覆盖。

- [x] **Step 4: 保留缺失模型的 offline 语义**

当前响应中不存在的站点模型继续标记为 `offline`；`offline` 与 `modality="unknown"` 不混用。重新出现的站点模型恢复为 `active`，但分类仍按人工覆盖规则处理。

- [x] **Step 5: 为发现流程增加回归检查**

在 `test-memefast-adapter.ts` 中确认返回的模型仍包含 `model_type` 等原始字段；在发现集成测试中确认：

```text
首次发现 -> runtime 分类
再次发现 -> site 且未人工覆盖时刷新分类
人工修改 -> capsOverridden=1
再次发现 -> 保留人工分类
```

### Task 4：补齐 unknown 和分类证据的数据语义

**Files:**
- Modify: `packages/server/src/db/schema/models.ts`
- Create: `packages/server/drizzle/0006_add-model-modality-evidence.sql`
- Modify: `packages/server/drizzle/meta/_journal.json`
- Modify: `packages/server/src/routes/admin/models.ts`
- Modify: `packages/server/src/engine/wizard/types.ts`
- Modify: `packages/server/src/engine/wizard/index.ts`

**Schema:**

```ts
modality: text("modality", {
  enum: ["llm", "image", "audio", "video", "embedding", "unknown"],
}).notNull(),
modalitySource: text("modality_source", {
  enum: ["manual", "runtime", "schema", "catalog", "keyword", "unknown"],
}).notNull().default("unknown"),
modalityConfidence: text("modality_confidence", {
  enum: ["high", "medium", "low"],
}).notNull().default("low"),
modalityReason: text("modality_reason"),
```

- [x] **Step 1: 修改 Drizzle schema 和管理 API 类型**

允许读取 `unknown`；管理员编辑 `modality`、`endpointCaps` 或 `paramCaps` 时写入 `modalitySource="manual"`、`modalityConfidence="high"`，并保留 `capsOverridden=1` 语义。列表接口和详情接口返回三个证据字段。

- [x] **Step 2: 写入安全迁移**

迁移只执行以下 SQLite 结构变更，不重建 `models` 表：

```sql
ALTER TABLE models ADD COLUMN modality_source TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE models ADD COLUMN modality_confidence TEXT NOT NULL DEFAULT 'low';
ALTER TABLE models ADD COLUMN modality_reason TEXT;
```

历史数据回填规则：`caps_overridden=1` 的记录设为 `manual/high/legacy_manual_override`；其他记录设为 `unknown/low/legacy_unverified`，等待下一次发现或管理员确认。`modality` 本身不需要 SQL 迁移，因为现有 SQLite 列无 CHECK 约束。

- [x] **Step 3: 兼容向导**

向导可以展示 `unknown` 作为“待确认建议”，但提交生成变体时仍要求管理员选择 `llm`、`embedding`、`image`、`audio` 或 `video`，避免 unknown 模型被当作可执行模型。

- [x] **Step 4: 应用迁移并运行数据库验证**

Run:

```powershell
pnpm --filter @openhub/server db:migrate
pnpm --filter @openhub/server exec tsx src/scripts/test-discover-flow.ts
```

Expected: 迁移成功，旧模型可读，`unknown` 可插入，已有站点和变体关系不变。

### Task 5：让目录只做低优先级补全

**Files:**
- Create: `packages/server/src/engine/catalog/modality.ts`
- Modify: `packages/server/src/engine/catalog/match-after-discover.ts`
- Modify: `packages/server/src/engine/wizard/index.ts`

- [x] **Step 1: 提取目录 modality 转换函数**

实现纯函数 `inferModalityFromCatalog(inJson, outJson)`，只使用目录 Schema 中已存在的 `text`、`image`、`audio`、`video`、`pdf` 值；没有明确输出类型时返回 `null`，不默认 `llm`。

- [x] **Step 2: 只更新低优先级记录**

目录匹配完成后，仅当模型未人工覆盖且 `modalitySource` 为 `unknown` 或 `keyword` 时，才用明确目录 modality 更新模型。`runtime` 和 `schema` 来源永远不被目录覆盖；目录只更新类型证据，不自动增加未经上游确认的 endpoint 能力。

- [x] **Step 3: 复用向导中的转换逻辑**

删除向导内重复的目录 modality 推断实现，改为调用同一个纯函数，避免两个模块对同一目录数据得出不同类型。

- [x] **Step 4: 验证目录边界**

确认目录候选可以补全 `unknown`，但不能覆盖 `runtime`；确认没有目录匹配的模型仍保留 `unknown` 或原有更高优先级结果。

### Task 6：管理界面显示真实状态

**Files:**
- Modify: `packages/web/src/pages/Models.tsx`

- [x] **Step 1: 扩展模型类型**

加入 `unknown`、`modalitySource`、`modalityConfidence` 和 `modalityReason` 字段；不把 `unknown` 映射成灰色的 `llm` 标签。

- [x] **Step 2: 显示证据状态**

在模型行和详情中显示：

```text
模态：unknown / llm / embedding / image / audio / video
来源：MemeFast 原生 / Schema / 目录 / 名称规则 / 人工 / 未知
置信度：high / medium / low
```

`unknown` 显示为“待复核”，但不新增调用按钮或自动变体。

- [x] **Step 3: 运行前端构建**

Run:

```powershell
pnpm --filter @openhub/web build
```

Expected: 构建通过，模型列表能渲染旧数据和新增 `unknown` 数据。

### Task 7：全量回归、真实站点复查和验收

**Files:**
- No new production files; use the modified files above.

- [x] **Step 1: 运行最小测试集**

Run:

```powershell
pnpm --filter @openhub/server exec tsx --test test-memefast-modality.ts
pnpm --filter @openhub/server exec tsx --test test-memefast-adapter.ts
pnpm --filter @openhub/server test
```

Expected: 新增分类测试和现有 server 测试通过；若完整 typecheck 仍被基线已有错误阻塞，只记录具体错误，不修改无关代码。

- [x] **Step 2: 重新发现真实 MemeFast 模型**

启动本地后端和前端，在 `http://localhost:5173/admin/sites` 对现有 MemeFast 站点执行“重新发现模型”。不在命令行或浏览器日志中输出 API Key。

- [x] **Step 3: 验收已知误判**

检查以下模型不再出现旧分类：

```text
Embedding-V1 / text-embedding-* -> embedding
speech-*                       -> audio
wan2.5-i2v / wan2.6-i2v       -> video
kling-audio                   -> audio
```

模型名只用于强规则兜底；最终类型以页面显示的来源和置信度为准。

- [ ] **Step 4: 验收人工覆盖和能力边界**

人工改为其他类型后再次同步，确认类型和 endpoint 能力保持不变；对 `unknown` 模型确认页面提示待复核，不能自动创建可调用变体；对视频模型确认这里只识别和标记能力，不声称已经支持 MemeFast 原生视频执行。

- [x] **Step 5: 验收数据和工作树**

确认分类来源、置信度、原因与模型记录一起保存；确认没有 API Key、临时调试文件或无关改动进入工作树；不提交、不推送、不创建 PR。

## 3. 验收标准

- [x] MemeFast 原生 `model_type` 能正确区分已确认的对话、图像、视频、音频和 Embedding 模型。
- [x] `supported_endpoint_types` 与 `tags` 能补充多个 `endpointCaps`，但不会伪造未验证的调用能力。
- [x] 无法确认的模型显示 `unknown`，不会默认成为 `llm`。
- [x] 已确认 Schema 和目录只在规定优先级内生效。
- [x] 重新同步会修正站点来源且未人工覆盖的历史模型。
- [ ] 人工覆盖在后续同步中保持不变。
- [x] 非 LLM 模型不存在目录误补全的 LLM 参数。
- [x] 管理界面显示模态、来源和置信度，且不把未知模型伪装成可用模型。
- [x] 本地网页测试通过；不依赖外部浏览器状态以外的生产配置。

## 5. 实际执行记录

- 2026-08-29：重启目标工作树后端与前端，后端使用 Node 22，避免 better-sqlite3 的 Node 24 ABI 不兼容。
- 2026-08-29：修复目录补全闸门；只有最终模态为 `llm` 才写入 LLM 参数，非 LLM 记录同步时清空残留字段。
- 真实 MemeFast 重新发现：`discovered=0`、`updated=467`、`offline=0`、`matched=255`、`unmatched=212`、`schemaMatched=11/467`。
- 真实分类统计：`audio=34`、`embedding=7`、`image=34`、`llm=224`、`unknown=135`、`video=33`。
- 真实数据库核验：`staleNonLlm=0`，没有非 LLM 模型残留上下文、输出上限、推理、函数调用或视觉能力字段。
- 回归验证：服务端测试 `27/27` 通过；前端 TypeScript 检查和 Vite 生产构建通过；`http://localhost:5173/` 与后端健康接口均返回 `200`。
- 页面核验通过：`kling-audio` 为 `audio`，`speech-02-hd` 为 `audio`，`text-embedding-3-small` 为 `embedding`，`wan2.6-i2v` 为 `video`，`ERNIE-3.5-8K` 为 `unknown`。
- 另修复本地 Vite `/admin/*` 路由与 API 代理冲突：HTML 导航返回前端页面，JSON 请求继续代理后端。
- 当前 MemeFast 站点 `capsOverridden=1` 记录数为 `0`，因此人工覆盖的真实二次同步场景尚未被数据触发；相关代码测试已通过。

## 4. 明确不做

- 不把 467 个模型全部强行分类为五种已知类型。
- 不通过关键词表继续堆叠供应商特例来替代原生元数据。
- 不把 OpenHub 目录变成 MemeFast 运行时参数合同。
- 不实现视频提交、轮询、回调、上传等 P1 能力。
- 不重写已通过验证的 MemeFast 连接器、URL 规范化和超时处理。
- 不为这个问题引入新的数据库、队列、缓存或通用插件系统。

**执行结果定义：**重新同步后，OpenHub 对模型“知道什么就明确标记，不知道就标记未知”；模型分类与实际调用能力分离，目录只补全，人工确认拥有最终控制权。
