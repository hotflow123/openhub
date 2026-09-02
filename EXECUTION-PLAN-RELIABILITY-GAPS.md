# OpenHub 可靠性缺口修复执行计划

- 编制日期：2026-08-31
- 工作树：`E:\code\openhub\worktrees\memefast-connector`
- 分支：`codex/feat/memefast-connector`
- 计划状态：R0-R5 已执行；R6 受真实供应商凭据闸门阻塞；R7 待 R6 后执行
- 计划范围：模型身份识别、Catalog 匹配、Schema 模板、参数映射、四类模态适配器、视频创建/查询链路和管理端状态展示

## 1. 独立分析

### 1.1 已确认的问题

当前暴露的不是单个视频模型的问题，而是系统把四件不同的事情混在了一起：

1. “这个名字可能是谁”被当成“已经确认是谁”。
2. “有一个同模态 Schema”被当成“这个 Schema 属于当前模型”。
3. “适配器有基础协议”被当成“所有参数都可用”。
4. “模型已发现”被当成“模型已经可以真实调用”。

这会同时产生两种错误：

- 假阳性：错误 Schema、错误端点或错误参数被标记为可用，真实调用时失败或调用了错误模型。
- 假阴性：明明能从模型族、版本、模态和可信 Catalog 判断身份，却长期显示“待确认”，使 OpenHub 失去目录和补全价值。

### 1.2 已确认事实

以下数据来自当前工作树中的数据库、代码和已执行测试记录，不是推测：

| 项目 | 已确认结果 |
| --- | --- |
| 模型总数 | 467 |
| 模态分布 | LLM 314、图片 51、音频 35、Embedding 10、视频 54、未知 3 |
| Catalog | 已匹配 214、未匹配 253 |
| Schema | 候选 96、未匹配 371、当前确认数 0 |
| 执行状态 | ready 408、needs_review 59 |
| 视频状态 | 54 个视频全部 needs_review，54 个视频契约全部 unverified |
| 变体 | 当前 4 个：LLM 1 个、图片 1 个、音频 2 个 |
| 已通过测试 | 服务端 85 项、客户端 3 项、MemeFast 5 项；Node 22 类型检查、适配器索引检查、Web 生产构建通过 |
| 本地页面 | `/admin/models`、`/admin/sites`、`/admin/variants`、`/admin/adapters` 可访问 |
| 健康检查 | `/health` 返回 200 |
| 尚缺证据 | 尚未完成真实 MemeFast 视频创建、轮询、成功结果下载/转存 Smoke Test |
| 已知噪音 | `favicon.ico` 仍 404；余额探测路径 `/api/api/v1/account/balance` 仍 404，不能作为视频不可用的根因 |

### 1.3 合理推测

- 视频全部不可用，主要原因是视频操作契约和参数契约没有经过真实证据闭环，而不是“视频模型天然不能接入”。
- 部分 Fal 端点只是候选映射；Fal 的端点参数不能直接证明 MemeFast 使用同一套请求路径、字段名和任务查询协议。
- `gpt-5.5-pro-2026-04-23` 这类名称可以依靠可信模型目录中的规范 ID、模型族、版本和模态进行高置信度识别；这不等于在代码中为某个名字写 `if`。
- 无供应商字段时仍可能识别模型，但证据必须来自可信 Catalog、规范别名、唯一模型族和操作类型的组合；只有普通字符串相似度时必须保留待确认。

### 1.4 未验证假设

以下内容在执行前必须通过当前 Key、当前站点地址或供应商文档验证，不能写死：

- MemeFast 当前视频模型到底使用哪一个创建接口、查询接口、任务状态枚举和结果字段。
- MemeFast 是否对全部列出的模型开放视频操作，还是只开放其中一部分。
- MemeFast 是否接受 Fal 风格的字段名，或需要由适配器转换成自己的请求结构。
- 某个 Fal endpoint 是否真的对应某个 MemeFast 模型；端点名称相似不是证据。
- 同一模型族的所有版本是否共享相同的参数限制、参考媒体数量和任务生命周期。

## 2. 目标和边界

### 2.1 本计划完成后的目标

每一个模型都必须能清楚回答以下问题：

1. 它是谁：规范模型、模型族、供应商证据和识别置信度。
2. 它是什么：LLM、图片、视频、音频或 Embedding，以及具体操作。
3. 走什么：供应商适配器、协议和实际端点。
4. 参数到什么程度：完整、部分、未知；哪些字段已映射，哪些字段未验证。
5. 能不能调用：可调用、未验证、参数不足、契约不匹配或最近调用失败。
6. 为什么不能调用：页面显示可行动的证据和下一步，而不是只显示“不可用”。

### 2.2 状态语义

状态必须分层展示，不能再用一个状态代替全部结论：

| 层级 | 允许的含义 | 不允许的误读 |
| --- | --- | --- |
| Identity | 名称线索、Catalog 识别、管理员确认 | 不能代表已可调用 |
| Modality | LLM、图片、视频、音频、Embedding | 不能代表参数完整 |
| Contract | 协议已确认、候选、未验证 | 不能代表所有参数已覆盖 |
| Parameters | 完整、部分、未知，带字段证据 | 不能把未知字段静默丢弃 |
| Runtime | 已验证可调用、未测试、需复核、最近失败 | 不能用“已发现”伪装成功 |
| Schema | 候选、预览、管理员确认、已应用 | 不能因同模态就自动确认 |

执行闸门必须满足：模型身份和操作明确、适配器支持该操作、必填参数有映射、未知字段没有被静默丢弃、请求通过校验；缺少任一项时显示真实原因并阻止默认执行。

### 2.3 明确不承诺的内容

- 不承诺“所有供应商的所有模型自动即插即用”。供应商协议不同，必须逐适配器验证。
- 不把 Fal Schema 原样复制给 MemeFast。Fal Schema 只能作为规范参数模板或证据来源，最终必须经过目标适配器映射。
- 不用单个模型名硬编码来解决识别问题。
- 不通过自动改名掩盖原始模型 ID；原始 ID 永远保留。
- 不通过扩大默认参数或吞掉未知字段来制造“可用”假象。

## 3. 长期维护成本与风险控制

### 3.1 必须承担的维护成本

- 维护数据驱动的模型规范 ID、别名、模型族、模态和供应商证据。
- 维护每个适配器的操作契约、字段映射和任务生命周期。
- 供应商接口变化后重新运行契约检查和真实 Smoke Test。
- 保存每次识别、Schema 应用和运行探测的证据来源与时间。

### 3.2 不能接受的维护方式

- 在 `if/else` 中不断追加具体模型名。
- 为每个供应商复制一套几乎相同的模型状态逻辑。
- 在 UI 中单独修一个状态，绕过服务端的证据门禁。
- 用“匹配率”代替真实调用成功率。
- 用测试夹具结果替代真实供应商请求结果。

### 3.3 最小化方案

优先复用当前的模型档案、Catalog matcher、Schema matcher、参数映射器、Adapter SDK 和探测表；只有现有字段无法表达“候选/确认/未验证”时，才增加最少字段或证据记录，不再创建第二套模型系统。

## 4. 文件地图

| 区域 | 主要文件 | 责任 |
| --- | --- | --- |
| 状态与契约 | `packages/server/src/lib/model-contract.ts`、`packages/server/src/engine/capability/status.ts` | 分离身份、契约、参数和运行状态 |
| 识别与 Catalog | `packages/server/src/engine/model-profile.ts`、`packages/server/src/engine/infer.ts`、`packages/server/src/engine/discover.ts`、`packages/server/src/engine/catalog/*.ts` | 名称归一化、模型族识别、证据评分、冲突处理 |
| Schema | `packages/server/src/engine/catalog/schema-matcher.ts`、`packages/server/src/routes/admin/wizard.ts`、`packages/web/src/pages/Wizard.tsx` | 预览、兼容性、字段映射、显式应用 |
| 参数与执行 | `packages/server/src/engine/param-mapper.ts`、`packages/server/src/engine/adapter.ts`、`packages/server/src/engine/tasks/worker.ts` | 参数保留、校验、转换和执行闸门 |
| SDK | `packages/adapter-sdk/src/common.ts`、`packages/adapter-sdk/src/manifest.ts`、`packages/adapter-sdk/src/model-binding.ts`、`packages/adapter-sdk/src/video.ts`、`packages/adapter-sdk/src/image.ts`、`packages/adapter-sdk/src/audio.ts`、`packages/adapter-sdk/src/llm.ts` | 四类模态的统一能力边界 |
| 适配器 | `packages/server/src/engine/adapters/memefast.ts`、`packages/server/src/engine/adapters/openai.ts`、`packages/server/src/engine/adapters/grok.ts`、`packages/server/src/engine/adapters/kling.ts`、`packages/server/src/engine/adapters/seedance.ts`、`packages/server/src/engine/adapters/wan.ts` | 供应商协议和真实端点实现 |
| 管理端 | `packages/web/src/pages/Models.tsx`、`packages/web/src/pages/Variants.tsx`、`packages/web/src/pages/Catalog.tsx`、`packages/web/src/components/*.tsx` | 状态筛选、证据展示、Schema 操作和参数编辑 |
| 测试 | `packages/server/test-model-matching.ts`、`packages/server/test-model-contract.ts`、`packages/server/test-schema-template-compatibility.ts`、`packages/server/test-param-mapper.ts`、`packages/server/test-video-contract.ts`、`packages/server/test-video-adapters.ts`、`packages/server/test-memefast-adapter.ts` | 单元、契约、映射和适配器回归 |
| 文档 | `docs/ADAPTER-SDK.md`、`docs/MULTIMODAL-INTEGRATION.md`、`docs/MULTIMODAL-PROVIDER-EVIDENCE.md` | 供应商接入和证据标准 |

## 5. 分阶段执行任务

### R0：备份和基线冻结

**修改前动作**

- 执行 `pnpm --filter @openhub/server db:backup`，保留数据库备份。
- 将实际要修改的文件复制到新的 `backups/reliability-gaps-YYYYMMDD-HHmmss/` 目录，不覆盖已有备份。
- 记录 `git status --short`、当前分支、Node 版本和 pnpm 版本。

**基线验证命令**

```powershell
pnpm --filter @openhub/server test
pnpm --filter @openhub/server typecheck
pnpm --filter @openhub/memefast test
pnpm --filter @openhub/memefast typecheck
pnpm --filter @openhub/web typecheck
pnpm --filter @openhub/web build
pnpm --filter @openhub/server adapter-index:check
```

**验收标准**

- 备份目录存在且能还原所有本次修改文件和数据库。
- 基线结果保存到执行记录；已有失败必须与本计划新增失败分开。
- 不得因为基线失败而回滚当前工作树中的其他未提交修改。

### R1：重建状态契约，消除“已识别等于可用”

**涉及文件**

- `packages/server/src/lib/model-contract.ts`
- `packages/server/src/engine/capability/status.ts`
- `packages/server/src/engine/model-profile.ts`
- `packages/server/src/routes/admin/models.ts`

**执行内容**

- 保留现有兼容字段，统一输出 Identity、Contract、Parameters、Runtime 四层状态。
- 明确 `contract=confirmed` 只表示基础请求/响应协议已证实，不表示参数覆盖完整。
- 明确 `parameterCoverage=partial/unknown` 时，页面不能显示“全部参数可用”。
- `runtime=ready` 只能由适配器能力、必填参数和有效探测证据共同产生；模型发现、名称匹配或 Schema 候选不得单独产生 ready。
- 为每个降级状态输出机器可读原因，例如 `identity_ambiguous`、`contract_unverified`、`parameter_unknown`、`runtime_not_tested`、`candidate_endpoint_needs_review`。

**验证**

```powershell
pnpm --filter @openhub/server exec tsx --test test-model-contract.ts test-probe-classification.ts
pnpm --filter @openhub/server typecheck
```

**验收标准**

- 同一模型可以同时显示“身份已识别、契约已确认、参数部分确认、运行未测试”，不再被压成一个“正常”。
- 没有运行证据的模型不会显示为可执行。
- 旧接口字段仍可被当前 Web 页面读取，不出现破坏性 API 变化。

### R2：建立数据驱动的模型身份识别标准

**涉及文件**

- `packages/server/src/engine/model-profile.ts`
- `packages/server/src/engine/infer.ts`
- `packages/server/src/engine/discover.ts`
- `packages/server/src/engine/catalog/matcher.ts`
- `packages/server/src/engine/catalog/match-after-discover.ts`
- `packages/server/src/engine/catalog/profile.ts`
- `packages/catalog/src/matcher/match-model.ts`
- `packages/catalog/src/sync/types.ts`

**执行内容**

- 保留原始模型 ID，统一做大小写、分隔符、供应商前缀和日期版本的归一化，但不改写原值。
- 优先使用可信 Catalog 的规范 ID、别名、模型族、模态和供应商证据；这些内容放在数据源或生成索引中，不写成具体模型名分支。
- 当供应商字段缺失时，允许使用“规范模型族 + 唯一版本/操作 + 模态”的组合证据识别供应商；只有普通关键词命中或多个候选接近时，保持 `ambiguous`。
- 将名称证据、Catalog 证据、站点元数据、Schema 证据和管理员确认分别记录，不能互相覆盖。
- 对多个候选返回排名、差异字段和原因；不自动选择一个低置信度候选。
- 生成一组覆盖真实 467 个模型分布的回归样本，重点包含无供应商字段、版本日期、别名、同名跨厂商和视频操作名。

**验证**

```powershell
pnpm --filter @openhub/server exec tsx --test test-model-matching.ts test-model-profile-sync.ts
pnpm --filter @openhub/server exec tsx --test test-schema-template-compatibility.ts
pnpm --filter @openhub/server typecheck
```

**验收标准**

- 不增加针对 `gpt-5.5`、某个视频模型或某个供应商的单独硬编码分支。
- 可信 Catalog 能识别的模型不再因为缺少 vendor 字段而全部待确认。
- 无唯一证据的模型仍然待确认，并显示缺少哪一类证据。
- 识别结果不会覆盖原始名称，也不会伪造供应商元数据。

### R3：修正 Fal Schema 的预览、校验和应用流程

**涉及文件**

- `packages/server/src/engine/catalog/schema-matcher.ts`
- `packages/server/src/routes/admin/wizard.ts`
- `packages/server/src/engine/param-mapper.ts`
- `packages/web/src/pages/Wizard.tsx`
- `packages/web/src/pages/Variants.tsx`

**执行内容**

- 把流程拆成三个明确动作：`预览候选`、`校验映射`、`确认应用`。
- `evaluateSchemaTemplateCompatibility()` 必须接收真实的 Schema 证据状态和模型身份状态，禁止调用方强行传入 `schemaConfirmed: true`。
- 兼容性判断至少检查：目标模态、具体操作、模型族/规范 ID、适配器协议、必填字段、字段类型、枚举/范围、输入媒体类型和任务生命周期。
- `candidate` 只返回候选，不得返回 `applied=true` 或 `contract=confirmed`。
- Schema 选择不得覆盖模型现有身份；应用记录必须保存 Schema 来源、版本、映射结果、未映射字段和确认人/时间。
- Fal Schema 应当进入“规范参数模板”层，由 MemeFast 或其他供应商适配器负责最终请求转换；没有目标适配器映射时，不得把 Fal 请求体直接发送给目标站点。

**参数变体规则**

- Schema 默认值只填充用户没有提供的字段。
- 用户修改的比例、分辨率、时长、首帧/尾帧、参考图片/视频/音频数量必须保留，并重新按 Schema 和适配器约束校验。
- 合法的变体值应保存并传给适配器，不得因为不同于默认值就回退。
- 超出供应商限制时拒绝保存并指出字段、实际值和允许范围；不能静默回退成默认值。
- 未知字段不能静默丢弃：要么由适配器声明透传，要么显示未支持并阻止执行。

**验证**

```powershell
pnpm --filter @openhub/server exec tsx --test test-schema-template-compatibility.ts test-param-mapper.ts
pnpm --filter @openhub/server typecheck
pnpm --filter @openhub/web typecheck
```

**验收标准**

- 同模态但错误模型的 Schema 不会自动变成 confirmed。
- 预览候选不会改变数据库中的模型身份和运行状态。
- 用户将图片/视频/音频参考数量、比例、分辨率或时长改为 Schema 允许值后，保存结果与提交参数一致。
- 不支持的参数有明确错误，不出现“保存成功但实际丢失”。

### R4：补齐四类模态的适配器运行契约

**涉及文件**

- `packages/adapter-sdk/src/common.ts`
- `packages/adapter-sdk/src/manifest.ts`
- `packages/adapter-sdk/src/model-binding.ts`
- `packages/adapter-sdk/src/llm.ts`
- `packages/adapter-sdk/src/image.ts`
- `packages/adapter-sdk/src/audio.ts`
- `packages/adapter-sdk/src/video.ts`
- `packages/adapter-sdk/src/lifecycle.ts`
- `packages/server/src/engine/adapter.ts`
- `packages/server/src/engine/adapters/memefast.ts`
- `packages/server/src/engine/adapters/openai.ts`
- `packages/server/src/engine/adapters/grok.ts`
- `packages/server/src/engine/adapters/kling.ts`
- `packages/server/src/engine/adapters/seedance.ts`
- `packages/server/src/engine/adapters/wan.ts`
- `packages/server/src/engine/param-mapper.ts`
- `packages/server/src/engine/tasks/worker.ts`
- `packages/server/src/routes/v1/chat.ts`
- `packages/server/src/routes/v1/images.ts`
- `packages/server/src/routes/v1/audio.ts`
- `packages/server/src/routes/v1/video.ts`

**执行内容**

- 统一表达每个适配器支持的模态、操作、请求映射、响应映射和任务生命周期。
- 视频能力必须独立验证 `create`、`query`、状态映射、失败映射、结果 URL 和过期后重新查询；只有“能列出模型”不能算视频可用。
- MemeFast 适配器只使用已从 MemeFast 文档或真实响应证明的路径和字段；不能因为 Fal 有同名 endpoint 就复用 Fal 请求体。
- 对同步响应和异步任务响应分别建契约测试，避免把视频任务当作一次性响应处理。
- Worker 只执行通过 R1/R3 闸门的变体；失败时保存供应商状态、HTTP 状态、错误码和安全摘要，不记录 Key。
- 对 LLM、图片、音频、视频保持同一套状态规则，但允许每个适配器声明自己的参数和任务差异。

**验证**

```powershell
pnpm --filter @openhub/server exec tsx --test test-adapter-sdk.ts test-adapter-registry.ts test-adapter-security.ts
pnpm --filter @openhub/server exec tsx --test test-video-contract.ts test-video-adapters.ts test-memefast-adapter.ts test-memefast-modality.ts
pnpm --filter @openhub/server typecheck
pnpm --filter @openhub/server adapter-index:check
```

**验收标准**

- 每个适配器清楚列出“支持的操作”，不再把模型发现结果当成操作支持。
- MemeFast 视频没有真实创建/查询契约时，页面明确显示“视频契约未验证”，而不是错误地显示正常可执行。
- 真实支持的视频模型完成创建、查询、状态转换和结果提取后，才可以进入可执行状态。
- Fal、MemeFast 和其他供应商的协议不会互相污染。

### R5：管理端展示真实状态并提供筛选

**涉及文件**

- `packages/web/src/pages/Models.tsx`
- `packages/web/src/pages/Variants.tsx`
- `packages/web/src/pages/Catalog.tsx`
- `packages/web/src/pages/Wizard.tsx`
- `packages/web/src/components/*.tsx`
- 必要时 `packages/web/src/lib/api.ts`

**执行内容**

- 模型列表支持一级供应商和二级模态筛选：LLM、图片、视频、音频、Embedding、未知。
- 同时支持按 Identity、Contract、Parameters、Runtime 筛选，避免只看一个“正常/不可用”标签。
- 每行显示原始 ID、规范模型、供应商证据、适配器、协议、参数覆盖度和最近运行证据。
- “编辑”“预览 Schema”“确认应用”“列表检查”“运行 Smoke Test”职责分离；候选结果不能直接伪装成已应用。
- 错误文案必须说明下一步，例如“需要确认 MemeFast 视频查询协议”，而不是泛化成“不可用”。
- 修复已知页面噪音：补充 `favicon.ico`，同时将余额探测 404 与模型/视频执行错误分开显示。

**验证**

```powershell
pnpm --filter @openhub/web typecheck
pnpm --filter @openhub/web build
```

**人工验收**

1. 打开 `/admin/models`，依次筛选 LLM、图片、视频、音频，列表数量和标签一致。
2. 打开一个视频模型，能看到“身份、协议、参数、运行”四层状态和具体原因。
3. 选择一个 Fal Schema，只能先预览；错误模型不会显示已应用。
4. 修改比例、分辨率、时长和参考媒体数量，保存后重新打开，值不丢失、不回退。
5. 控制台不再出现嵌套 `<button>` 警告，`/favicon.ico` 返回 200。

### R6：真实供应商 Smoke Test 与发布闸门

**前置条件**

- 用户提供或确认当前有效的 MemeFast API 地址和 Key；Key 只通过本地环境变量或管理端密钥存储使用，不能写入计划、日志、截图或 Git。
- 用户确认允许产生一次低成本视频任务，并选择一个文档明确支持、时长和分辨率最低的模型。
- 供应商接口文档或真实响应已经确认创建和查询路径；如果路径未确认，先完成适配器契约验证，不得盲试多个付费端点。

**执行步骤**

1. 在站点配置中使用已保存 Key，执行模型发现并保存原始响应摘要。
2. 选择一个已通过静态契约检查的视频模型，提交最小合法请求。
3. 记录 HTTP 状态、任务 ID、供应商状态、OpenHub 状态和错误摘要。
4. 按适配器规则查询任务，覆盖排队、运行、成功或失败中的实际状态。
5. 成功时验证结果 URL/媒体信息；失败时验证错误可追踪且没有泄露 Key。
6. 重新打开模型列表，确认状态变化由证据驱动，不能由手工刷新伪造。

**验证命令**

```powershell
pnpm --filter @openhub/memefast smoke
pnpm --filter @openhub/server test
pnpm --filter @openhub/server typecheck
pnpm --filter @openhub/web build
```

**验收标准**

- 至少一个 MemeFast 视频模型完成真实创建和查询闭环，或明确记录供应商拒绝及其证据。
- 没有真实闭环的其他视频模型仍显示未验证，不被批量标记为可用。
- 真实失败能区分身份错误、协议错误、参数错误、权限错误、限流和供应商故障。
- 测试输出不包含完整 API Key、Authorization 头或敏感请求体。

### R7：全量回算、回归和交付

**执行内容**

- 对现有 467 个模型重新计算身份、模态、Catalog、Schema、参数和运行状态。
- 输出按供应商/模态/适配器/契约/参数覆盖度/运行状态分组的矩阵。
- 单独列出：可执行、仅识别、仅有 Schema 候选、参数不完整、协议未验证、最近失败和未知模型。
- 将实际仍未解决的项目写入 `docs/MULTIMODAL-PROVIDER-EVIDENCE.md`，不把未验证项从列表中隐藏。
- 更新 `docs/ADAPTER-SDK.md` 和 `docs/MULTIMODAL-INTEGRATION.md`，只记录已经实现和验证的流程。

**全量验证命令**

```powershell
pnpm test
pnpm typecheck
pnpm --filter @openhub/server adapter-index:check
pnpm --filter @openhub/web build
```

**最终验收标准**

- 所有模型都有明确的身份、模态、协议、参数覆盖度和运行状态；没有空白状态。
- 系统不再因“名字像”或“同模态”自动确认错误 Schema。
- 系统不再因缺少供应商字段就放弃所有可从可信 Catalog 识别的模型。
- Schema 模板可以被预览、校验、显式应用，并支持用户合法修改常用变体参数。
- 未知参数不会静默丢失，供应商不支持的参数会给出明确原因。
- 每一种已宣布支持的视频操作都有创建、查询、状态和结果证据；没有证据的模型继续显示未验证。
- Web 页面、服务端测试、适配器测试和真实 Smoke Test 结果一致。

## 6. 失败处理规则

- 静态识别成功但协议未验证：保留识别结果，禁止执行，提示补充契约证据。
- Schema 候选存在但模型身份不唯一：允许预览，不允许自动应用；要求管理员确认或更强 Catalog 证据。
- Schema 已应用但参数只覆盖一部分：允许保存已验证字段，未覆盖字段必须可见；执行前阻止缺失必填字段。
- 真实调用失败：记录失败证据并降级运行状态，不删除模型、不改名、不自动切换到另一个供应商端点。
- 供应商返回 404：先判断路径拼接、协议版本和适配器映射，再判断模型不存在；不能直接归因于网络不可达。
- 余额探测或 favicon 等非核心错误：单独修复和展示，不得污染模型身份、Schema 或视频契约结论。

## 7. 计划自检

- 本计划不包含具体模型名硬编码方案。
- 本计划不把 Fal Schema 当成所有供应商的原生协议。
- 本计划不承诺所有模型自动可用。
- 每个阶段都指定了文件、验证命令和验收标准。
- 真实视频 Smoke Test 被列为人工发布闸门，而不是用 fixture 冒充成功。
- 用户修改比例、分辨率、时长和参考媒体数量的需求已纳入参数保存、校验和转发规则。
- 当前未验证内容已明确列出，没有把合理推测写成事实。

## 8. 执行完成后的实际结果

执行完成后，OpenHub 不会简单地把 467 个模型都涂成“可用”。它会变成一个可靠的模型接入控制台：能自动识别有证据的模型，能用 Catalog 和 Schema 补全参数，能把用户改过的合法参数传给对应适配器，也能明确告诉用户某个模型为什么还不能运行。真正完成创建、查询和结果闭环的视频模型会显示可执行；没有证据的模型会继续显示未验证，但不会再被错误地当成已支持。

本次执行记录见 `docs/RELIABILITY-GAPS-EXECUTION-20260831.md`。R6 未在没有已确认的 MemeFast 地址、Key、低成本模型和账单授权时盲试付费端点；因此 R7 的全量回算和发布闸门保留到真实证据完成后。
