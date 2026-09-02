# 模型身份确认修复执行计划

> **For agentic workers:** Execute the tasks in order. Each task must pass its listed checks before the next task starts. Do not add model-specific aliases or rewrite provider model IDs.

**Goal:** 让高可信、唯一且结构完整的目录匹配自动进入“身份已识别”，同时保留参数不完整和运行时不可用的独立状态。

**Architecture:** 保留现有模型原始 ID、目录匹配和运行时探测三层。复用现有结构化匹配器的版本、变体、尺寸、操作、模态和候选间距判断；只有已经达到现有 `0.9` 匹配门槛的 `structured` 结果才确认身份。目录匹配仍只提供参数建议，不能把参数覆盖为供应商真实 Schema。

**Tech Stack:** TypeScript、Node.js `22`、SQLite/Drizzle、`node:test`、React/Vite。

## Global Constraints

- 供应商原始模型 ID 必须在数据库、变体和转发请求中保持不变。
- 禁止为 `gpt`、`deepseek` 或任意单模型增加硬编码别名。
- 身份确认、能力契约、参数覆盖和运行时可用性必须继续分开。
- `structured` 自动确认必须复用现有唯一候选和 `confidence >= 0.9` 规则，不能新增一个更宽松的模糊阈值。
- 目录数据只能补全建议；没有供应商或运行时证据时，参数状态仍为 `partial` 或 `unknown`。
- 不批量调用图片、音频、视频任务；真实调用只使用一个 LLM 的最小请求。
- 执行和测试使用项目要求的 Node `22`，不安装 Visual Studio C++ Build Tools。

---

## 1. 已确认事实与缺陷

- 数据库中的原始模型为 `gpt-5.5-pro-2026-04-23`。
- 当前目录匹配为 `openai/gpt-5.5-pro`，匹配来源为 `structured`，匹配等级为 `high`。
- 当前 `model_identity_status=ambiguous`，原因是 `match-after-discover.ts` 只把 `exact`、`normalized` 当作身份确认；`structured` 被一律写成候选。
- `modelEvidenceState()` 又把所有非 `exact`、`normalized`、`admin` 的目录身份降级为 `ambiguous`，因此即使结构化匹配已经满足现有高置信度门槛，页面仍显示“身份待确认”。
- 当前 `capability_contract_status=confirmed`，但参数为 `partial`；这不是本次身份缺陷，不能顺便改成参数完整。

## 2. 修复原则

身份确认采用以下不依赖具体模型名称的规则：

1. `exact`、`normalized`、人工确认继续直接确认。
2. `structured` 只有在现有匹配器已经返回 `confidence >= 0.9` 时确认。该结果同时意味着：候选模态兼容、家族/版本/尺寸/变体/操作兼容、最佳候选与下一候选间距达到现有门槛。
3. 未达到上述条件的 `structured`、`alias`、`keyword` 或名称规则只产生候选，不确认身份。
4. “身份已识别”不等于“当前 Key 可调用”；运行时探测仍单独决定可执行状态。

## 3. 文件变更范围

- 修改 `packages/server/src/engine/catalog/match-after-discover.ts`：把满足现有高置信度门槛的 `structured` 匹配写为 `recognized`。
- 修改 `packages/server/src/lib/model-contract.ts`：不再把已持久化为 `recognized` 的结构化目录身份重新降级。
- 修改 `packages/server/test-model-contract.ts`：覆盖结构化高置信度身份状态和弱匹配降级。
- 修改 `packages/server/test-model-matching.ts`：保留并强化日期后缀、版本、变体和候选间距规则测试。
- 如页面文案仍把“身份已识别、参数部分已知”合并为“待确认”，才修改 `packages/web/src/pages/Models.tsx`；优先不改页面结构。
- 不新增数据库字段、不修改原始模型名、不新增适配器。

## 4. 执行任务

### Task 1：先固定身份确认策略测试

**Files:**
- Modify: `packages/server/test-model-contract.ts`
- Modify: `packages/server/test-model-matching.ts`

- [ ] 增加一个 `modelEvidenceState()` 用例：`modelIdentityStatus="recognized"`、`modelIdentitySource="catalog"`、`catalogMatchSource="structured"` 时，身份必须保持 `recognized`；`capabilityContractStatus="confirmed"` 且适配器可用时，执行状态必须为 `ready`。
- [ ] 增加一个反例：`modelIdentityStatus="ambiguous"`、`catalogMatchSource="structured"` 时仍为 `ambiguous`，证明低置信度历史数据不会被无条件升级。
- [ ] 保留现有 `gpt-5.5-2026-04-23` 结构化匹配测试，并明确断言结果来源为 `structured`、置信度不低于 `0.9`。
- [ ] 保留同家族不同规模、不同变体、不同模态和候选间距不足时不匹配的测试。

Run:

```powershell
$env:PATH=(Resolve-Path '.runtime\node22').Path+';'+$env:PATH
& '.runtime\node22\node.exe' 'node_modules\tsx\dist\cli.mjs' --test packages/server/test-model-contract.ts packages/server/test-model-matching.ts
```

Expected: 新增测试在旧实现下至少有一个失败，失败点是结构化高置信度结果仍被标为 `ambiguous`。

### Task 2：修改匹配后的身份写入策略

**Files:**
- Modify: `packages/server/src/engine/catalog/match-after-discover.ts`

- [ ] 将身份确认条件集中为现有匹配门槛：`exact`、`normalized`，或 `structured && result.confidence >= 0.9`。
- [ ] 对确认结果写入 `modelIdentityStatus="recognized"`、`modelIdentitySource="catalog"`、`modelIdentityReason="catalog_<source>_match"`。
- [ ] 对不满足条件的结果继续写入 `ambiguous`，并保留候选来源；不得修改 `rawName`。
- [ ] 不改变 `catalogMatchConfidence`、参数快照或 Schema 关联逻辑。

Expected: `gpt-5.5-pro-2026-04-23` 这类已有高置信度结构化匹配会被确认；低置信度和多候选模型仍需人工复核。

### Task 3：停止读取时错误降级

**Files:**
- Modify: `packages/server/src/lib/model-contract.ts`
- Test: `packages/server/test-model-contract.ts`

- [ ] 将弱目录身份判断限制为“目录来源且尚未被明确确认为 `recognized`”的历史记录。
- [ ] 已持久化的 `recognized` 记录不得因为 `catalogMatchSource="structured"` 被再次降级。
- [ ] 保持 `modelIdentityStatus="ambiguous"` 的旧记录为待确认，直到重新执行匹配获得新的确认结果。
- [ ] 保持参数覆盖规则不变：目录没有真实 Schema 时，`parameterCoverage` 仍不得升级为 `complete`。

Expected: API 的 `modelEvidenceState` 对确认后的结构化匹配返回 `identityStatus="recognized"`、`executionStatus="ready"`；参数仍可能为 `partial`。

### Task 4：本地重算现有模型并做真实最小验证

**Files:**
- No additional source files.

- [ ] 先备份本次实际修改文件，再用 Node `22` 运行定向测试、服务端类型检查和前端类型检查。
- [ ] 使用当前数据库对 MemeFast 站点重新执行已有发现/匹配流程；只重算身份和目录关联，不批量发起媒体任务。
- [ ] 查询 `gpt-5.5-pro-2026-04-23`，确认身份变为 `recognized`，目录仍为 `openai/gpt-5.5-pro`，参数仍显示 `partial` 或 Schema 未关联。
- [ ] 用已保存 MemeFast Key 对一个明确可用的 LLM 做一次 `max_tokens=32` 测试，确认运行时状态独立显示 `available`。
- [ ] 对一个上游返回 `404` 或超时的模型确认系统显示 `unsupported` 或 `temporary_failure`，不能改变身份字段。
- [ ] 不遍历 467 个模型，不创建图片、音频或视频任务。

Expected: 页面最终表达为“身份已识别、能力契约已确认、参数部分已知、最近调用可用/不可用”，而不是把所有信息合并成一个“待确认”。

### Task 5：网页回归与最终验收

**Files:**
- Modify `packages/web/src/pages/Models.tsx` only if existing text still contradicts the API state.

- [ ] 启动同一工作树的后端和前端。
- [ ] 打开 `/admin/models`，搜索 `gpt-5.5-pro-2026-04-23`，确认身份显示为已识别，参数仍显示未完整关联。
- [ ] 打开 `/admin/variants`，确认不把参数部分已知误显示为模型身份待确认。
- [ ] 检查浏览器控制台；不得出现嵌套 `<button>`、运行时异常或请求失败导致的空白页。
- [ ] 运行最终检查：服务端测试、客户端测试、两包类型检查、前端生产构建和 `git diff --check`。

Expected: 代码、数据库状态、API 和网页四层语义一致；任何自动确认都能由匹配来源、置信度和唯一候选机制解释。

## 5. 验收标准

- `gpt-5.5-pro-2026-04-23` 不再因为 `structured + high` 被错误标为 `ambiguous`。
- 低置信度结构化匹配、多候选匹配、模态冲突和不同版本/规模仍保持待确认或未匹配。
- 原始模型名没有任何改写。
- 目录参数没有被伪装成供应商 Schema；参数状态仍独立显示。
- 身份确认不会把上游权限、404、限流或超时误判为模型可用。
- 现有单元测试、服务端类型检查、前端类型检查、前端构建和本地网页验收全部通过。

## 6. 明确不做

- 不为 `gpt-5.5-pro`、`deepseek` 或其他单模型添加别名。
- 不把所有 `structured` 结果无条件升级；必须满足现有 `confidence >= 0.9` 和唯一候选门槛。
- 不从目录直接推断供应商私有参数。
- 不把身份确认、参数完整和运行时可用合并为一个状态。
- 不以一次成功调用替代长期供应商健康监控。
