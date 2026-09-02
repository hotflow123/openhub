# 多模态模板闭环 Implementation Plan

> For agentic workers: execute this plan task-by-task with a review checkpoint after each task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 让 OpenHub 的 Open-Generative-AI 模板从“文件存在”真正变成“可同步、可选择、可绑定、可执行”的本地闭环。状态：已完成（2026-09-01）。

**Architecture:** Open-Generative-AI 只提供带来源的参数知识，不直接充当供应商 API。模板先经过身份、模态、操作、协议、字段映射和适配器能力检查，再绑定到具体 Variant；真正的请求仍由现有适配器发送。

**Tech Stack:** TypeScript、Node 22、Drizzle ORM、SQLite、Zod、Node test、Hono、React、Vite、pnpm。

## 独立分析

### 已确认事实

- packages/catalog/data/open-generative-ai.snapshot.json 已存在：439 条记录、128 个字段。
- 当前运行数据库有 467 个模型，但 model_parameter_templates 为 0 条，Variant 模板绑定为 0 条。
- packages/server/src/engine/catalog/match-after-discover.ts 依赖 process.cwd() 查找快照；从 packages/server 启动时路径错误。
- 同一文件会静默捕获快照加载异常并返回空结果。
- packages/server/src/routes/admin/models.ts 的应用模板接口只修改模板状态，没有绑定 Variant。
- packages/web/src/pages/Variants.tsx 查询了模板，但没有渲染可用选择控件。
- packages/server/src/routes/router.ts 只有 Variant 已绑定模板后才会读取模板快照。
- MemeFast 视频必须显式配置 variant.adapterConfig.video.protocol；不能从模型名称猜协议。
- 服务端 84 项测试、目录测试、类型检查、Web 构建和适配器索引检查已通过，但没有证明同步数据库和执行闭环成功。

### 合理推测

- 当前主要问题是运行时接线缺失，而不是参数目录不存在。
- 先支持公共字段和已验证协议，可以解决大多数实际使用场景。
- 供应商私有字段不能凭名字自动发送，必须有适配器映射或进入明确的 provider_options。

### 未验证假设

- Open-Generative-AI 每个字段是否被 MemeFast 每个协议接受，必须由 fixture 或供应商文档验证。
- 本计划不使用真实计费的视频创建请求。
- Open-Generative-AI 当前数据源不承担完整 LLM 参数百科；LLM 继续使用现有 Catalog、适配器和运行时证据。

## 范围边界

本计划完成：

- 快照从 packages/server 启动目录也能被找到。
- 发现后模板真正写入数据库，重复同步幂等。
- 管理员能看到模板并选择模板。
- 模板能绑定具体 Variant，并进入请求参数合并链。
- 比例、分辨率、时长和参考媒体数量可以在边界内覆盖。
- 未映射字段、未确认协议和超限值不会静默发送。
- 使用本地 HTTP fixture 完成验证。

本计划不承诺：

- 439 条模板全部自动可执行。
- 所有供应商共用同一套请求参数。
- 所有供应商在本轮都具备完整 SDK。
- 模板匹配或应用直接等于运行时 ready。
- 真实计费供应商请求成功。

## 文件地图

| 文件 | 责任 |
|---|---|
| packages/server/src/engine/catalog/match-after-discover.ts | 快照加载、候选同步、同步结果 |
| packages/server/src/engine/catalog/parameter-template-matcher.ts | 模态、操作、协议、字段映射和兼容性 |
| packages/server/src/engine/adapter-manifest.ts | 适配器模板绑定和证据 |
| packages/server/src/routes/admin/variants.ts | 模板绑定到 Variant |
| packages/server/src/routes/admin/models.ts | 模板查询和兼容性预览 |
| packages/server/src/routes/router.ts | 读取模板并阻止未应用模板执行 |
| packages/server/src/engine/param-mapper.ts | 模板默认值和字段映射合并 |
| packages/web/src/pages/Models.tsx | 模板来源和状态展示 |
| packages/web/src/pages/Variants.tsx | 模板选择和应用 |
| packages/web/src/pages/Wizard.tsx | 模板预览和最终绑定 |
| packages/server/test-template-closed-loop.ts | 闭环集成测试 |
| docs/OPEN-GENERATIVE-AI-TEMPLATE-EVIDENCE.md | 来源和限制记录 |
| COMPLETION_STATUS.md | 最终完成状态 |

---

### Task 0: 冻结基线并建立失败测试

**Files:**
- Create: backups/template-closed-loop-timestamp/openhub.db
- Create: packages/server/test-template-closed-loop.ts
- Modify: EXECUTION-PLAN-TEMPLATE-CLOSED-LOOP.md

**Interfaces:**
- 使用现有 node:test、assert 和 SQLite fixture。
- Fixture 必须包含一个 MemeFast 站点、图片模型、视频模型、音频模型和 Variant。

- [x] Step 1: 记录基线

~~~powershell
$root = 'E:\code\openhub\worktrees\memefast-connector'
git -C $root status --short --branch
& "$root\.runtime\node22\node.exe" --version
corepack pnpm --version
~~~

- [x] Step 2: 备份运行数据库

~~~powershell
$root = 'E:\code\openhub\worktrees\memefast-connector'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "$root\backups\template-closed-loop-$stamp"
New-Item -ItemType Directory -Path $backup -Force | Out-Null
Push-Location "$root\packages\server"
& "$root\.runtime\node22\node.exe" scripts\backup-db.cjs "--output=$backup\openhub.db"
Pop-Location
~~~

- [x] Step 3: 写入四个失败验收

~~~typescript
test("loads the snapshot from packages/server cwd", async () => {
  assert.equal(await snapshotPathExistsFromServerCwd(), true);
});

test("syncs templates and is idempotent", async () => {
  const first = await syncFixtureDatabase();
  const second = await syncFixtureDatabase();
  assert.ok(first.templateCount > 0);
  assert.equal(first.templateCount, second.templateCount);
});

test("binds the applied template to a Variant", async () => {
  const result = await applyTemplateToFixtureVariant();
  assert.equal(result.variant.parameterTemplateId, result.template.id);
  assert.equal(result.template.matchStatus, "applied");
});

test("forwards a supported duration and two reference images", async () => {
  const request = await forwardFixtureVariant({
    duration: 8,
    image_urls: ["https://fixture.test/a.png", "https://fixture.test/b.png"],
  });
  assert.equal(request.duration, 8);
  assert.equal(request.image_urls.length, 2);
});
~~~

- [x] Step 4: 运行新测试并记录失败原因

~~~powershell
Push-Location 'E:\code\openhub\worktrees\memefast-connector'
& '.runtime\node22\node.exe' 'node_modules\tsx\dist\cli.mjs' --test 'packages\server\test-template-closed-loop.ts'
Pop-Location
~~~

---

### Task 1: 修复快照路径并取消静默失败

**Files:**
- Modify: packages/server/src/engine/catalog/match-after-discover.ts
- Modify: packages/server/src/routes/admin/sites.ts
- Modify: packages/server/.env.example
- Test: packages/server/test-template-closed-loop.ts

**Interfaces:**

~~~typescript
export function getOpenGenerativeAiSnapshotPath(): string;
export async function loadOpenGenerativeAiSnapshot(): Promise<OpenGenerativeAiSnapshot>;
~~~

- [x] Step 1: 使用环境变量或模块相对路径

~~~typescript
export function getOpenGenerativeAiSnapshotPath(): string {
  return process.env.OPENHUB_PARAMETER_TEMPLATE_SNAPSHOT_PATH?.trim()
    || fileURLToPath(new URL("../../../../catalog/data/open-generative-ai.snapshot.json", import.meta.url));
}
~~~

- [x] Step 2: 验证快照结构

加载时检查 source、records、snapshotSha256 和记录基本字段。文件不存在或 JSON 错误时抛出包含实际路径的错误，不得返回空结果。

- [x] Step 3: 在发现响应中返回模板同步证据

保留现有 matched、unmatched 字段，增加 parameterTemplatesSynced 和 parameterTemplateSnapshotSha256，让页面能区分模型发现成功与模板同步成功。

- [x] Step 4: 从 packages/server 运行路径测试

~~~powershell
Push-Location 'E:\code\openhub\worktrees\memefast-connector\packages\server'
& '..\..\.runtime\node22\node.exe' '..\..\node_modules\tsx\dist\cli.mjs' --test test-template-closed-loop.ts
Pop-Location
~~~

---

### Task 2: 让同步真正入库且不破坏应用状态

**Files:**
- Modify: packages/server/src/engine/catalog/match-after-discover.ts
- Modify: packages/server/src/db/schema/model-parameter-templates.ts
- Test: packages/server/test-parameter-template.ts
- Test: packages/server/test-template-closed-loop.ts

- [x] Step 1: 使用隔离数据库验证插入

Fixture 只写临时数据库，不写 packages/server/data/openhub.db。同步后断言 model_parameter_templates 数量大于零。

- [x] Step 2: 保持唯一键和来源证据

继续使用 modelId、source、sourceModelId、operation 唯一键，并保存 sourceCommit、sourceFileSha256 和 snapshotSha256。

- [x] Step 3: 保持重复同步幂等

同一快照重复同步只能更新同一行。已是 applied 且快照哈希未变化时保留 applied；快照哈希变化时改为 candidate，原因写为 snapshot_changed_requires_review。

- [x] Step 4: 只保存候选，不自动绑定 Variant

同步得到的 candidate、confirmed 或 incompatible 记录不能自动写入 variants.parameter_template_id。

- [x] Step 5: 运行数据库回归

~~~powershell
Push-Location 'E:\code\openhub\worktrees\memefast-connector\packages\server'
& '..\..\.runtime\node22\node.exe' '..\..\node_modules\tsx\dist\cli.mjs' --test test-parameter-template.ts test-template-closed-loop.ts
Pop-Location
~~~

---

### Task 3: 按源操作和明确协议判定兼容性

**Files:**
- Modify: packages/server/src/engine/catalog/parameter-template-matcher.ts
- Modify: packages/server/src/engine/adapter-manifest.ts
- Modify: packages/memefast/src/client.ts
- Test: packages/server/test-schema-template-compatibility.ts
- Test: packages/server/test-template-closed-loop.ts

**Interfaces:**

~~~typescript
evaluateParameterTemplateCompatibility({
  model,
  template,
  registration,
  operation,
  adapterConfig,
  templateConfirmed,
});
~~~

- [x] Step 1: 保留源操作

~~~typescript
const runtimeOperations = {
  "image.text_to_image": ["image.generation"],
  "image.image_to_image": ["image.edit"],
  "video.text_to_video": ["video.submit", "video.query"],
  "video.image_to_video": ["video.submit", "video.query"],
  "video.video_to_video": ["video.submit", "video.query"],
  "video.lipsync": ["video.submit", "video.query"],
  "video.recast": ["video.submit", "video.query"],
};
~~~

保留 sourceCollection 和 operation，不把所有媒体模板合并成一个模态。

- [x] Step 2: 视频只读取显式协议

从 adapterConfig.video.protocol 选择 MemeFast binding。没有协议时返回 candidate 和 video_protocol_required，不得确认。

- [x] Step 3: 只映射已验证公共字段

~~~typescript
const verifiedFields = [
  "prompt", "content", "duration", "aspect_ratio", "resolution",
  "image_url", "image_urls", "video_url", "video_urls",
  "audio_url", "audio_urls", "generate_audio", "seed",
];
~~~

images_list、reference_images、videos_list 和供应商私有字段不自动改名；没有证据就展示为未映射。

- [x] Step 4: 音频保持源操作

audio.source 不自动变成 audio.speech。只有适配器明确声明的语音或转写映射才能执行。

- [x] Step 5: 添加误匹配测试

~~~typescript
assert.equal(withoutProtocol.decision, "candidate");
assert.ok(withoutProtocol.reasons.includes("video_protocol_required"));
assert.equal(modalityMismatch.decision, "incompatible");
assert.ok(unknownField.unsupportedFields.includes("provider_private_field"));
~~~

---

### Task 4: 将模板原子绑定到 Variant

**Files:**
- Modify: packages/server/src/routes/admin/variants.ts
- Modify: packages/server/src/routes/admin/models.ts
- Modify: packages/server/src/routes/router.ts
- Modify: packages/server/src/engine/param-mapper.ts
- Test: packages/server/test-template-closed-loop.ts

**Interfaces:**

~~~http
POST /admin/variants/:variantId/parameter-template
Content-Type: application/json

{"templateId":"pt_example"}
~~~

- [x] Step 1: 校验模板归属和状态

模板必须属于 Variant 的模型。incompatible、conflict 直接拒绝；candidate 必须在当前 Variant 的适配器配置下重新评估为 confirmed。

- [x] Step 2: 一个 SQLite 事务完成应用

事务内重新读取模型、Variant 和模板，重新检查兼容性，设置模板 matchStatus 为 applied，写入 variants.parameter_template_id 和确认后的 field_mapping。任一检查失败时全部回滚。

- [x] Step 3: 禁止无 Variant 的全局应用

现有模型模板应用接口不得单独把模板改成 applied。它必须要求 variantId 并调用同一事务，或返回 400 parameter_template_variant_required。

- [x] Step 4: 运行时拒绝未应用模板

resolveRouteFromVariant 读取模板状态。绑定模板不是 applied 时返回 409 parameter_template_not_applied；没有绑定模板时保持原有行为。

- [x] Step 5: 合并模板映射和默认值

模板映射作为基础，Variant 明确保存的映射才可覆盖。模板默认值进入已有 param-mapper 默认值链；请求值和 Variant 强制覆盖继续遵循现有语义。

- [x] Step 6: 验证绑定

~~~typescript
const applied = await postTemplateToVariant(variant.id, template.id);
assert.equal(applied.data.variantId, variant.id);
assert.equal(applied.data.status, "applied");
~~~

---

### Task 5: 补齐管理页面

**Files:**
- Modify: packages/web/src/pages/Models.tsx
- Modify: packages/web/src/pages/Variants.tsx
- Modify: packages/web/src/pages/Wizard.tsx

- [x] Step 1: Variant 页面真正渲染模板选择器

模板选项显示来源、源模型、源操作、状态和置信度；按当前模型模态过滤；不能静默选择第一条。

- [x] Step 2: 分开预览和应用

选择候选模板只显示映射预览。点击应用后才调用 Variant 绑定接口；未确认协议、未映射必填字段和冲突必须显示具体错误。

- [x] Step 3: 显示可覆盖参数

对图片、视频和音频显示 aspect_ratio、resolution、duration、image_urls、video_urls 和 audio_urls 的可覆盖状态及上限。

- [x] Step 4: Wizard 在最终确认前展示证据

显示来源、源操作、选定协议、映射字段、未映射字段和可覆盖字段。没有点击最终确认时只保存候选，不改变运行状态。

- [x] Step 5: 保存后刷新查询

成功绑定后刷新 Variant、模型详情和模板列表，使页面立即显示绑定关系。

- [x] Step 6: Web 验证

~~~powershell
Push-Location 'E:\code\openhub\worktrees\memefast-connector'
corepack pnpm --filter @openhub/web typecheck
corepack pnpm --filter @openhub/web build
Pop-Location
~~~

---

### Task 6: 完成本地端到端验收

**Files:**
- Modify: packages/server/test-template-closed-loop.ts
- Modify: packages/server/test-parameter-template.ts
- Modify: packages/server/test-schema-template-compatibility.ts
- Modify: docs/OPEN-GENERATIVE-AI-TEMPLATE-EVIDENCE.md
- Modify: COMPLETION_STATUS.md
- Modify: EXECUTION-PLAN-TEMPLATE-CLOSED-LOOP.md

- [x] Step 1: 验证数据库

~~~sql
SELECT COUNT(*) FROM model_parameter_templates;
SELECT match_status, modality, COUNT(*)
FROM model_parameter_templates
GROUP BY match_status, modality;
SELECT COUNT(*) FROM variants WHERE parameter_template_id IS NOT NULL;
~~~

要求：发现后模板数大于零；显式应用后绑定 Variant 大于零；没有 Variant 绑定的模板不能是可执行的 applied 状态。

- [x] Step 2: 验证四类模板

1. 图片文生图：提示词、尺寸、质量。
2. 视频图生视频：提示词、时长、比例、分辨率、两张参考图。
3. 音频：源操作和未映射字段保持可见，不强行当作 TTS。
4. 未知供应商字段：显示未映射，不得静默发送。

- [x] Step 3: 验证运行时门禁

模板存在但没有当前能力探测时，仍返回 capability_unverified，fixture 不收到请求。模板应用且能力有效时，fixture 收到已合并的默认值和覆盖值。

- [x] Step 4: 运行完整检查

~~~powershell
$root = 'E:\code\openhub\worktrees\memefast-connector'
Push-Location $root
corepack pnpm --filter @openhub/catalog test
corepack pnpm --filter @openhub/server test
corepack pnpm --filter @openhub/server typecheck
corepack pnpm --filter @openhub/web typecheck
corepack pnpm --filter @openhub/web build
corepack pnpm --filter @openhub/server adapter-index:check
Pop-Location
~~~

- [x] Step 5: 只在验收通过后更新完成状态

记录同步数量、各状态数量、各模态和操作数量、已绑定 Variant 数量、未映射字段和未执行真实计费请求的事实。

## 最终验收标准

| 项目 | 标准 |
|---|---|
| 快照 | 从 packages/server 启动也能找到 |
| 同步 | 数据库模板数大于零，重复同步不重复 |
| 绑定 | 模板应用后确实写入 Variant |
| UI | 能选择模板并看到映射和限制 |
| 执行 | 模板默认值进入适配器请求 |
| 变体 | 公共媒体参数可在边界内覆盖 |
| 安全 | 未确认协议、未知字段和超限值被阻止 |
| 运行状态 | 模板不会绕过能力探测直接变成 ready |
| 回归 | 现有测试、类型检查、构建和适配器索引检查全部通过 |

## 预期产品形态

OpenHub 用目录提供参数知识，用证据决定能否采用，用模板生成参数基线，用 Variant 保存用户选择，用适配器完成真正的供应商请求。

它不是“所有供应商一键通用”，而是“公共参数可复用、供应商差异可验证、错误不会被隐藏”的多模态 AI 接入平台。
