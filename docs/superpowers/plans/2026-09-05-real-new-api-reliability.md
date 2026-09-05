# Real New API / MemeFast Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Execute this plan task-by-task with a review checkpoint after each task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用真实 New API / MemeFast 完成 OpenHub 核心链路的可重复验收：发现模型、分类能力、绑定协议、映射参数，并让下游通过 OpenHub 统一调用；不把 Mock 当作真实可用证明。

**Architecture:** OpenHub 保存上游返回的原始模型名和元数据，使用协议目录决定真实路径、请求体和任务生命周期，使用参数目录补全和校验请求字段。模型按自身证据独立发布，单个模型缺协议或上游额度不足不得阻塞其他模型的发现和调用。

**Tech Stack:** TypeScript, Hono, Drizzle ORM, SQLite, Node `fetch`, pnpm, React/Vite.

## Global Constraints

- 真实验收对象固定为 `https://api.memefast.cc`；不创建 Mock New API 代替真实验收。
- 提供的 MemeFast Key 只通过环境变量或加密站点配置使用，禁止写入源码、计划、fixture、日志或 Git。
- `GET /v1/models` 为零成本发现检查；真实生成请求只做一次最小 LLM 请求，不自动测试视频、图片或音频。
- Mock `fetch` 只能保留为适配器单元测试，不能把单元测试通过写成上游调用成功。
- 不增加新的协议表、依赖、SDK 层或通用 HTTP 执行器；复用现有 `protocol_catalog`、`model_protocol_bindings`、Adapter 和 Worker。
- 不实现计费、扣费、充值、余额同步或成本核算；额度和账单完全由 New API / MemeFast 管理。
- 永远保留上游 `model.id`；协议 ID、Fal endpoint 和目录 ID 不能改写下游模型名。
- 不按模型名称猜测请求路径；没有明确协议操作时，该模型单独不可执行，但不影响同站点其他模型。
- 生成类 POST 不自动重试；查询、健康检查和文档同步才允许有限重试。
- 协议同步失败只记录失败，不删除旧协议、不删除旧绑定、不批量下线模型。
- 未知字段不能静默丢弃；要么按明确映射发送，要么返回字段级错误。

## Evidence Baseline

截至本计划编写时已有真实证据：

```text
MemeFast GET /v1/models       HTTP 200，459 个模型
返回字段                       id、model_type、owned_by、supported_endpoint_types、tags
qwen3.8-flash 最小聊天请求     HTTP 200，返回 OK，总计 85 tokens
OpenHub /health                HTTP 200
```

尚未证明的内容：

- OpenHub 转发到真实 MemeFast 的完整 LLM 闭环。
- 图片、音频和 Embedding 的真实调用。
- 视频 `submit → query → result` 的真实媒体调用。

额度不足只能把“运行时已验证”保持为未验证，不能把它解释成协议错误，也不能退回 Mock 作为证明。

## State Model

每个模型独立使用以下状态，不能用一个笼统的“正常”代替：

```text
discovered
  上游 /v1/models 可见，已保存原始元数据

contract_ready
  模态、Adapter、请求协议和必要字段已明确，可进入 OpenHub 公开目录

runtime_verified
  使用真实上游 Key 成功完成过对应调用

blocked
  只表示该模型缺少明确协议、必要操作或当前 Key 权限/额度
```

状态规则：

- `discovered` 不要求付费调用。
- LLM/OpenAI-compatible 模型在上游明确声明 endpoint 且 Adapter 可用时可达到 `contract_ready`。
- 视频模型必须有明确的 `submit` 和 `query` 操作才能达到 `contract_ready`。
- `runtime_verified` 是额外证据，不作为全站发现和分类的硬门槛。
- `blocked` 只作用于当前模型，不得让整个站点或其他模态消失。

## File Map

本计划只允许触及以下职责范围：

- `packages/server/src/engine/discover.ts`: 读取并保存真实 `/v1/models` 元数据。
- `packages/server/src/engine/infer.ts`: 使用上游显式元数据优先确定模态，未知保持未知。
- `packages/server/src/engine/protocol-catalog.ts`: 协议版本、绑定和可执行性判断。
- `packages/server/src/engine/adapters/memefast.ts`: 按已绑定协议发送请求并转换响应。
- `packages/server/src/engine/param-mapper.ts`: 统一参数、变体覆盖和字段映射。
- `packages/server/src/routes/router.ts`: 路由前的逐模型门禁和上游 Key 解密。
- `packages/server/src/routes/v1/models.ts`: 公开目录的逐模型过滤。
- `packages/server/src/engine/publication-policy.ts`: 独立模型状态判断。
- `packages/server/test-memefast-adapter.ts`: 协议路径和参数映射回归测试。
- `packages/server/test-memefast-protocol.ts`: 协议导入、版本和失败保留测试。
- `packages/server/test-new-api-product.ts`: OpenHub 公共 API 烟囱测试。
- `MEMEFAST-PROTOCOL-INVENTORY.md`: 真实同步证据和当前缺口。
- `COMPLETION_STATUS.md`: 本轮真实验收结果。

禁止在本计划内新增第二套协议表、第二套 Adapter 注册表或第二套参数目录。

---

### Task 1: 建立真实验收基线

**Files:**
- Create: `backups/real-new-api-before-20260905/`，只备份本计划后续实际修改的文件。
- Test: 不修改源码，先运行现有检查。

**Interfaces:**
- Consumes: 当前仓库、真实 `MEMEFAST_KEY` 环境变量。
- Produces: 可比较的 Git 状态、构建状态和真实上游状态。

- [ ] **Step 1: 备份将要修改的现有文件**

```powershell
$files = @(
  "packages/server/src/engine/discover.ts",
  "packages/server/src/engine/infer.ts",
  "packages/server/src/engine/protocol-catalog.ts",
  "packages/server/src/engine/adapters/memefast.ts",
  "packages/server/src/engine/param-mapper.ts",
  "packages/server/src/routes/router.ts",
  "packages/server/src/routes/v1/models.ts",
  "packages/server/src/engine/publication-policy.ts",
  "packages/server/test-memefast-adapter.ts",
  "packages/server/test-memefast-protocol.ts",
  "packages/server/test-new-api-product.ts",
  "MEMEFAST-PROTOCOL-INVENTORY.md",
  "COMPLETION_STATUS.md"
)
New-Item -ItemType Directory -Force "backups/real-new-api-before-20260905" | Out-Null
foreach ($file in $files) {
  if (Test-Path $file) {
    Copy-Item -LiteralPath $file -Destination "backups/real-new-api-before-20260905/$([IO.Path]::GetFileName($file))" -Force
  }
}
```

- [ ] **Step 2: 运行当前回归检查**

```powershell
pnpm --dir packages/server test
pnpm --dir packages/server typecheck
pnpm --dir packages/web build
```

Expected: 记录当前失败项；不修复与本计划无关的历史脚本错误。

- [ ] **Step 3: 运行真实零成本发现检查**

```powershell
$env:MEMEFAST_KEY = "<只在当前进程设置，不写入文件>"
node --input-type=module -e "const r=await fetch('https://api.memefast.cc/v1/models',{headers:{Authorization:'Bearer '+process.env.MEMEFAST_KEY}});const p=await r.json();console.log(JSON.stringify({status:r.status,total:Array.isArray(p.data)?p.data.length:0,fields:Object.keys(p.data?.[0]??{})}));"
```

Expected: HTTP `200`，模型数量大于 0，输出不包含 Key。

- [ ] **Step 4: 保存基线，不提交密钥和响应全文**

```powershell
git status --short
git diff --stat
```

Expected: 只记录文件状态和统计，不把真实 Authorization 或完整模型响应写入仓库。

---

### Task 2: 固化真实模型发现和分类规则

**Files:**
- Modify: `packages/server/src/engine/discover.ts`
- Modify: `packages/server/src/engine/infer.ts`
- Test: `packages/server/test-memefast-protocol.ts`

**Interfaces:**
- Consumes: New API `/v1/models` 的 `id`、`model_type`、`owned_by`、`supported_endpoint_types`、`tags`。
- Produces: 保存原始模型名、厂商线索、模态和 endpoint 证据，供 Variant 和公开目录使用。

- [ ] **Step 1: 先写分类回归测试**

覆盖以下真实响应形状：

```ts
assert.equal(inferRuntimeModality({
  id: "qwen3.8-flash",
  model_type: "对话",
  owned_by: "custom",
  supported_endpoint_types: ["openai"],
}), "llm");

assert.equal(inferRuntimeModality({
  id: "veo_3_1",
  model_type: "音视频",
  owned_by: "google",
  supported_endpoint_types: ["OpenAI video format"],
}), "video");

assert.equal(inferRuntimeModality({
  id: "unknown-model",
  supported_endpoint_types: [],
}), "unknown");
```

- [ ] **Step 2: 运行测试并确认错误暴露**

```powershell
pnpm --dir packages/server exec tsx --test test-memefast-protocol.ts
```

Expected: 测试明确指出元数据优先级或未知模型处理的缺口；不通过猜测修改测试期望。

- [ ] **Step 3: 最小实现元数据优先级**

实现顺序固定为：

```text
model_type / supported_endpoint_types / tags
        ↓
已有显式人工覆盖
        ↓
名称规则只作为低置信度线索
        ↓
无法证明时 unknown
```

禁止用名称规则覆盖上游显式 `model_type` 或 endpoint 证据，禁止给未知模型虚构时长、分辨率、上下文或音频格式。

- [ ] **Step 4: 重跑分类测试**

```powershell
pnpm --dir packages/server exec tsx --test test-memefast-protocol.ts
```

Expected: 对话、图像、音视频、检索和未知样本分别得到稳定结果；未知样本不会自动公开为 LLM。

---

### Task 3: 让协议目录成为唯一的媒体请求依据

**Files:**
- Modify: `packages/server/src/engine/protocol-catalog.ts`
- Modify: `packages/server/src/engine/adapters/memefast.ts`
- Test: `packages/server/test-memefast-adapter.ts`
- Test: `packages/server/test-memefast-protocol.ts`

**Interfaces:**
- Consumes: `protocol_catalog`、`model_protocol_bindings` 和协议文档中的明确操作。
- Produces: `ProtocolRuntime`，至少能提供模型对应的请求方法、相对路径、请求契约和响应契约。

- [ ] **Step 1: 写协议完整性测试**

规则：

```text
视频可执行 = 明确的 POST video.submit
          + 明确的 GET video.query
          + 对应模型绑定

同步图片/音频 = 明确的请求操作
             + 请求字段契约
             + 响应转换规则
```

测试同时覆盖：缺 `query`、缺模型绑定、协议禁用、历史版本仍存在。

- [ ] **Step 2: 运行测试确认当前门禁**

```powershell
pnpm --dir packages/server exec tsx --test test-memefast-protocol.ts test-memefast-adapter.ts
```

- [ ] **Step 3: 按协议记录选择最新可用版本**

选择条件固定为：

```text
同一 protocolId
→ status = active
→ enabled = true
→ version 对应最新同步内容
→ 内容包含当前模型名或明确绑定关系
```

没有符合条件的记录时只阻塞该模型，不把整个站点标记为不可用。

- [ ] **Step 4: 让 Adapter 拒绝猜测路径**

`memefastAdapter` 只能从 `ctx.protocol.operations` 选择带有明确 `operationRole` 的操作：

```text
video.submit → POST
video.query  → GET
```

不能根据 `/generate`、`/task` 等路径片段临时猜测执行协议；路径必须是相对路径，不能由协议文档注入外部绝对 URL。

- [ ] **Step 5: 重跑协议和 Adapter 测试**

```powershell
pnpm --dir packages/server exec tsx --test test-memefast-protocol.ts test-memefast-adapter.ts
```

Expected: 协议路径、模型原名、任务 ID、状态和视频结果转换全部通过；缺协议时得到结构化失败，而不是发出错误请求。

---

### Task 4: 打通参数模板到真实请求的最小映射链

**Files:**
- Modify: `packages/server/src/engine/param-mapper.ts`
- Modify: `packages/server/src/engine/adapters/memefast.ts`
- Modify: `packages/server/src/routes/router.ts`
- Test: `packages/server/test-memefast-adapter.ts`

**Interfaces:**
- Consumes: 下游标准请求、Variant 覆盖、参数目录 Schema、协议 `requestContract` 和 `parameterMapping`。
- Produces: 不改模型名、不过滤合法参数、可审计的上游请求体。

- [ ] **Step 1: 写参数映射测试**

至少验证：

```ts
ratio       → ratio 或协议明确的 aspect_ratio
resolution  → resolution
duration    → duration
prompt      → content[{ type: "text", text: prompt }]（仅当协议声明 content）
参考图片/视频/音频数组 → 按协议声明的字段和数量发送
未知字段    → 字段级错误，不静默丢弃
```

- [ ] **Step 2: 运行测试确认当前行为**

```powershell
pnpm --dir packages/server exec tsx --test test-memefast-adapter.ts
```

- [ ] **Step 3: 实现固定的映射优先级**

```text
Variant fieldMapping
→ 协议 parameterMapping
→ 同名字段直传
→ 协议声明的 prompt/content 特殊转换
→ 未声明且不支持的字段报错
```

Fal / Open-Generative-AI 目录只提供参数名称、类型、枚举和限制参考；它不能决定 MemeFast URL、方法或响应格式。

- [ ] **Step 4: 保证合法变体参数不被错误回退**

当协议和模型 Schema 明确允许时，比例、分辨率、时长、参考媒体数量的修改必须进入真实请求。只有超出明确限制或目标协议没有该字段时才返回 `parameter_invalid` 或 `parameter_not_supported`。

- [ ] **Step 5: 重跑映射测试**

```powershell
pnpm --dir packages/server exec tsx --test test-memefast-adapter.ts
```

Expected: 请求体保留真实模型原名和合法参数；协议不能解释的字段收到明确错误。

---

### Task 5: 修正逐模型公开和执行门禁

**Files:**
- Modify: `packages/server/src/engine/publication-policy.ts`
- Modify: `packages/server/src/routes/v1/models.ts`
- Modify: `packages/server/src/routes/router.ts`
- Test: `packages/server/test-publication-policy.ts`
- Test: `packages/server/test-new-api-product.ts`

**Interfaces:**
- Consumes: 站点状态、模型状态、模态、Adapter 能力、协议就绪状态和 OpenHub Key 权限。
- Produces: 每个模型独立的公开决定和结构化执行错误。

- [ ] **Step 1: 写逐模型门禁测试**

覆盖以下结果：

```text
LLM + openai endpoint + chat adapter        → 可公开
视频 + submit/query 协议                    → 可公开
视频缺 query                                → 仅该模型不可执行
未知模态                                    → 仅该模型不公开
上游站点 offline                            → 该站点模型不公开
其他模型不受单个模型失败影响                 → 仍可见
```

- [ ] **Step 2: 运行门禁测试**

```powershell
pnpm --dir packages/server exec tsx --test test-publication-policy.ts
```

- [ ] **Step 3: 保持“契约可用”和“运行时已验证”分离**

`/v1/models` 只过滤站点、模型、Adapter 和协议契约；不因为没有付费运行时证据就把所有媒体模型统一改成不可用。运行时失败必须在单个请求上返回原因并记录证据状态。

- [ ] **Step 4: 验证权限过滤**

```powershell
pnpm --dir packages/server exec tsx --test test-new-api-product.ts
```

Expected: OpenHub Key 只能看到授权 Variant；公开 `id` 保持 Variant 原名，实际转发时恢复 `model.rawName`。

---

### Task 6: 用真实 MemeFast 完成一次最小 OpenHub 闭环

**Files:**
- Modify: `packages/server/test-new-api-product.ts`
- Modify: `MEMEFAST-PROTOCOL-INVENTORY.md`
- Modify: `COMPLETION_STATUS.md`

**Interfaces:**
- Consumes: 已配置的真实 MemeFast 站点、加密保存的上游 Key、OpenHub Key。
- Produces: 真实发现、真实 OpenHub 模型列表和一次最小真实 LLM 转发证据。

- [ ] **Step 1: 确认站点地址**

站点地址必须填写：

```text
https://api.memefast.cc
```

不要填写 `https://api.memefast.cc/v1` 或历史错误的 `/v1openai0`；发现逻辑会请求 `baseUrl + /v1/models`。

- [ ] **Step 2: 通过管理入口保存真实站点**

使用现有站点 CRUD 和加密存储，不新增配置文件：

```text
name     = MemeFast
baseUrl  = https://api.memefast.cc
apiKey   = 当前有额度 Key
adapter  = memefast
status   = active
```

保存响应和日志不得回显 Key。

- [ ] **Step 3: 执行真实发现**

```text
POST /admin/sites/:siteId/discover
```

Expected：

```text
HTTP 200
模型数量 > 0
qwen3.8-flash 能被发现
模型原名不被改写
分类来自上游字段或明确证据
```

- [ ] **Step 4: 执行一次最小真实 OpenHub LLM 请求**

```json
{
  "model": "qwen3.8-flash",
  "messages": [{"role": "user", "content": "回复OK"}],
  "max_tokens": 1,
  "temperature": 0
}
```

通过 OpenHub：

```text
POST /v1/chat/completions
Authorization: Bearer <OpenHub Key>
```

Expected：

```text
HTTP 200
返回内容为 OK
请求实际到达 api.memefast.cc
上游模型仍为 qwen3.8-flash
不出现 OpenHub Key 或 MemeFast Key
```

- [ ] **Step 5: 处理额度或权限错误**

如果返回 `403 local:insufficient_quota`：

```text
结论 = 上游额度不足
状态   = 发现和契约验证保留，runtime_verified 不置为 true
动作   = 不重试、不换 Mock、不下线全站
```

只有真实返回 `200` 才把本次 LLM 记录为 `runtime_verified`。

---

### Task 7: 协议同步和失败保留验收

**Files:**
- Modify: `packages/server/test-memefast-protocol.ts`
- Modify: `MEMEFAST-PROTOCOL-INVENTORY.md`

**Interfaces:**
- Consumes: `https://docs.memefast.cc/` 的官方协议源和现有 allow-list。
- Produces: 可追踪的协议版本、哈希、差异和同步失败记录。

- [ ] **Step 1: 运行官方源同步**

使用现有入口：

```text
POST /admin/memefast/protocols/sync?source=memefast-docs
```

- [ ] **Step 2: 验证成功结果**

检查：

```text
added / changed / unparsed / failed
协议记录有 contentHash
新版本不覆盖旧版本
模型绑定指向协议记录而不是协议名称猜测
```

- [ ] **Step 3: 验证失败保留**

用测试替身仅模拟文档源网络失败，确认：

```text
sync_runs.status = failed
旧 protocol_catalog 仍存在
旧 model_protocol_bindings 仍存在
已公开模型不被批量删除
```

这类测试只验证数据库保护逻辑，不冒充真实上游调用。

- [ ] **Step 4: 更新库存报告**

报告必须明确写出：

```text
真实发现已验证到哪一步
协议文档同步到哪一版
哪些模型只有 contract_ready
哪些模型真正 runtime_verified
哪些模型因协议或额度 blocked
```

---

### Task 8: 最终验收和停止条件

**Files:**
- Modify: `COMPLETION_STATUS.md`
- Modify: `MEMEFAST-PROTOCOL-INVENTORY.md`

**Interfaces:**
- Consumes: 所有单元、构建、真实上游和 OpenHub 闭环结果。
- Produces: 可审计的“已达到/未达到”结论。

- [ ] **Step 1: 运行完整本地检查**

```powershell
pnpm --dir packages/server test
pnpm --dir packages/server typecheck
pnpm --dir packages/web build
```

- [ ] **Step 2: 检查真实服务**

```powershell
Invoke-WebRequest http://localhost:3000/health -UseBasicParsing
```

Expected: HTTP `200`。

- [ ] **Step 3: 检查真实闭环结论**

达到本计划目标的最低条件：

```text
真实 MemeFast /v1/models 可发现
模型原名不变
模态分类不把未知模型强行归为 LLM
协议版本可同步且失败不破坏旧数据
OpenHub /v1/models 能返回授权的可契约调用模型
至少一次真实 LLM 请求经 OpenHub 成功
```

不把以下内容伪装成已完成：

```text
所有视频模型已真实生成成功
所有图片/音频供应商已运行时验证
所有自定义协议都能被同一请求格式调用
一个无额度 Key 能证明生成链路可靠
```

- [ ] **Step 4: 停止继续加功能**

当最低条件满足后，停止新增目录、Adapter、重试和 SDK 功能。下一阶段只有在拿到明确的媒体测试额度和真实失败样本后，才针对一个协议补齐 `submit/query/result` 闭环。

## Review Checklist

- [ ] 没有创建 Mock New API 或用 Mock 作为验收结论。
- [ ] 没有把真实 Key 写入仓库、计划、fixture 或日志。
- [ ] 没有通过模型名硬编码供应商、URL 或参数。
- [ ] 没有把 Fal/OGA endpoint 当成 MemeFast 请求协议。
- [ ] 没有因为一个视频模型缺协议而隐藏整个视频分类或整个站点。
- [ ] 没有对可能产生上游费用的创建请求自动重试。
- [ ] 没有新增重复的协议、Adapter 或参数目录体系。
- [ ] 每个“已验证”结论都有真实请求或明确文档证据。

## Known Gaps Kept Deliberately

- 本计划不消耗额度逐个验证 459 个模型。
- 本计划不在没有真实媒体额度时伪造视频、图片或音频成功。
- 本计划不把第三方网站 SDK 包装作为当前核心验收项。
- 本计划不承诺供应商没有公开协议时可以自动猜出正确请求。
