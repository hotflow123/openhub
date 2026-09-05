# Video Full Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or inline execution to implement this plan task-by-task. Each task ends with an independent verification checkpoint.

**Goal:** 将 MemeFast 当前发现的全部视频模型完成协议和参数准备，并提供用户主动触发的单模型真实验证；OpenHub 不在发现或同步阶段替用户批量消耗上游额度。

**Architecture:** 保留 New API/MemeFast 返回的原始模型名。MemeFast 协议目录负责端点和任务生命周期，OpenHub 目录负责参数模板，现有 MemeFast Adapter 负责请求和响应转换，发布门禁负责决定 Variant 是否可调用。全量处理不等于盲目全开：49 个模型都进入审核矩阵，成功的逐项公开，失败的保留原因并继续隐藏。

**Tech Stack:** TypeScript, Hono, Drizzle ORM, SQLite, Node `fetch`, `tsx`, Node test runner.

## Global Constraints

- 不新增计费系统，不复制 New API，不新增第二套 Adapter 架构。
- 不修改下游公开模型名；上游原始 `model` 必须原样发送。
- 不把 Fal 或 Open-Generative-AI endpoint 名称当成 MemeFast 的真实模型名。
- 不凭模型关键词直接放行；必须有协议契约、参数契约和运行证据。
- 视频创建请求不自动重试；查询可以有限重试，但不得重复提交生成任务。
- 4 秒只是用户主动测试时的默认值；实际最小值必须以该模型的真实协议契约为准。
- 用户提供的 Key 只保存在站点加密字段；不得写入源码、日志、计划或测试输出。
- 每个任务开始前必须有数据库和涉及源码备份；任何阶段失败都可以恢复。
- 不因一个模型成功而自动放行同协议下的其他模型；模型枚举和运行证据必须逐项核对。

## Current Evidence

- MemeFast `/v1/models` 已发现 459 个模型，其中视频模型 49 个。
- LLM、Embedding、图片真实链路已验证。
- Seedance 已完成 MemeFast 真实提交和查询，后台显示成功。
- 2026-09-06 已用用户已有 Seedance 任务完成单模型核验；未新增生成任务。
- 已修复混合协议记录中“提交端点族”和“查询端点族”不一致导致的查询失败。
- `memefast.ts` 已修复两个已证实问题：
  - 查询优先选择带 `{task_id}` 的单任务端点。
  - 导入协议使用直接 `requestBody.properties` 时，将 `prompt` 转为 `content`。
- 当前视频协议仍有导入记录未启用；不能把“已发现”当成“可调用”。

## Execution Status (2026-09-06)

- [x] 创建本轮可恢复备份：`backups/video-verification-fix-before-20260906_034031`
- [x] 用最小测试复现混合端点族查询错误
- [x] 修复查询端点选择
- [x] 用同一最小测试回归通过
- [x] 用用户已有任务 ID完成真实查询核验
- [x] 仅公开 Seedance 已验证模型
- [ ] 其余 48 个视频模型逐个取得用户证据

本轮没有批量生成视频，也没有因协议名称或模型名称直接放行。

## File Map

- Modify: `packages/server/src/engine/adapters/memefast.ts` — 仅保留已验证的端点选择和请求转换。
- Modify: `packages/server/src/engine/protocol-catalog.ts` — 明确协议完整性、绑定范围和最新记录选择。
- Modify: `packages/server/src/engine/publication-policy.ts` — 维持未验证协议不可公开。
- Modify: `packages/server/src/routes/v1/models.ts` — 只公开当前 Key 有权限且通过门禁的 Variant。
- Modify: `packages/server/src/routes/router.ts` — 转发前检查模型、协议、Adapter 和参数契约。
- Modify: `packages/server/src/engine/tasks/worker.ts` — 查询失败只记录并等待下一次查询，禁止重复提交。
- Test: `packages/server/test-memefast-adapter.ts`
- Test: `packages/server/test-memefast-protocol.ts`
- Test: `packages/server/test-publication-policy.ts`
- Create: `packages/server/src/scripts/verify-memefast-video-release.ts` — 单模型、单任务、用户主动触发的真实验证命令。
- Create: `packages/server/test-video-release.ts` — 用户确认、单次提交和发布状态的最小测试。
- Update: `COMPLETION_STATUS.md` — 写入真实通过数、阻塞数和证据范围。
- Create: `VIDEO-RELEASE-REPORT.md` — 保存本次逐模型验收结果，不保存任何 Key。

### Task 1: Create a Recoverable Baseline

**Files:**
- Create: `backups/video-full-release-before-<timestamp>/openhub.db`
- Create: `backups/video-full-release-before-<timestamp>/source/`
- Create: `backups/video-full-release-before-<timestamp>/MANIFEST.md`

**Interfaces:**
- Consumes: current SQLite database and current working tree.
- Produces: one restorable database, source snapshot, file hashes, and running baseline.

- [ ] **Step 1: Stop the backend and worker**

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess |
  ForEach-Object { Stop-Process -Id $_ -Force }
```

- [ ] **Step 2: Copy the database and changed source files**

```powershell
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backup = "backups/video-full-release-before-$stamp"
New-Item -ItemType Directory -Force "$backup/source" | Out-Null
Copy-Item "packages/server/data/openhub.db" "$backup/openhub.db"
Copy-Item "packages/server/src/engine/adapters/memefast.ts" "$backup/source/"
Copy-Item "packages/server/src/engine/protocol-catalog.ts" "$backup/source/"
Copy-Item "packages/server/src/engine/publication-policy.ts" "$backup/source/"
Copy-Item "packages/server/src/routes/v1/models.ts" "$backup/source/"
Copy-Item "packages/server/src/routes/router.ts" "$backup/source/"
Copy-Item "packages/server/src/engine/tasks/worker.ts" "$backup/source/"
Get-FileHash "$backup/openhub.db" -Algorithm SHA256 | Out-File "$backup/MANIFEST.md"
Get-ChildItem "$backup/source" | Get-FileHash -Algorithm SHA256 | Out-File -Append "$backup/MANIFEST.md"
```

- [ ] **Step 3: Run the baseline checks**

```powershell
pnpm test
pnpm typecheck
```

Expected: all existing tests pass before any release-state change.

### Task 2: Sync and Freeze the Latest MemeFast Protocol Snapshot

**Files:**
- Modify: database rows in `protocol_catalog`, `model_protocol_bindings`, and `variants`
- Create: `VIDEO-RELEASE-REPORT.md`

**Interfaces:**
- Consumes: allow-listed MemeFast documentation source and current `/v1/models`.
- Produces: a timestamped inventory containing every video model, protocol record, binding, schema status, and release state.

- [ ] **Step 1: Start the backend from the backed-up baseline**

```powershell
pnpm exec tsx --env-file=.env src/index.ts
```

- [ ] **Step 2: Sync only the configured MemeFast documentation source**

Use the existing admin protocol-source list, then call the existing sync endpoint with the returned allow-listed source. Do not import arbitrary URLs.

- [ ] **Step 3: Write the inventory**

The inventory must contain these columns:

```text
raw_model_name
model_id
variant_id
variant_name
protocol_record_id
protocol_id
protocol_version
protocol_status
protocol_enabled
binding_evidence_status
submit_method
submit_path
query_method
query_path
parameter_template
release_state
blocked_reason
```

- [ ] **Step 4: Check the inventory before enabling anything**

Expected:

- exactly 49 current video models are accounted for;
- every release candidate has one latest protocol record;
- every protocol has a relative submit and query operation;
- no model is enabled merely because its name contains `veo`, `kling`, `seedance`, `wan`, or another family token;
- duplicate records remain historical and are not used as the active record.

### Task 3: Lock Adapter and Contract Conformance

**Files:**
- Modify: `packages/server/src/engine/adapters/memefast.ts`
- Modify: `packages/server/src/engine/protocol-catalog.ts`
- Test: `packages/server/test-memefast-adapter.ts`
- Test: `packages/server/test-memefast-protocol.ts`

**Interfaces:**
- Consumes: one explicit protocol document and one model binding.
- Produces: a deterministic `submit → query` adapter path without model renaming or silent parameter loss.

- [ ] **Step 1: Run the regression tests before changing this task**

```powershell
pnpm exec tsx --test test-memefast-adapter.ts test-memefast-protocol.ts
```

- [ ] **Step 2: Keep the query selection rule**

For `video.query`, select a `GET` operation containing `{id}`, `{task_id}`, or `{taskId}` before a task-list operation. For `video.submit`, select only a `POST` operation with the explicit `video.submit` role.

- [ ] **Step 3: Keep direct-property schema conversion**

When an imported operation stores fields under `requestBody.properties` and exposes `content` but not `prompt`, convert:

```text
{ model, prompt, duration, ratio }
```

to:

```text
{ model, content: [{ type: "text", text: prompt }], duration, ratio }
```

Preserve reference `image_url`, `video_url`, and `audio_url` arrays when they are explicitly present. Do not invent assets.

- [ ] **Step 4: Add the two regression assertions**

```text
query chooses /tasks/{task_id}, not /tasks
direct-property schema removes prompt and emits content
```

- [ ] **Step 5: Run the task checks**

```powershell
pnpm exec tsx --test test-memefast-adapter.ts test-memefast-protocol.ts
pnpm typecheck
```

### Task 4: Add User-Triggered Single-Model Verification

**Files:**
- Create: `packages/server/src/scripts/verify-memefast-video-release.ts`
- Create: `packages/server/test-video-release.ts`
- Modify: `packages/server/package.json`

**Interfaces:**
- Consumes: `--model <raw-model-name>`, explicit `--confirm-charge`, current OpenHub site, current protocol binding, and the user's OpenHub Key.
- Produces: one user-owned result record with `submit_http`, `site_task_id`, every query status, final result URL presence, cost/error text with secrets removed, and a release decision.

- [ ] **Step 1: Make the command refuse all non-user-triggered paid calls**

Discovery, catalog sync, protocol sync, model matching, and background workers must never call a billable video submit endpoint. The verification command must exit before submission unless the user explicitly supplies `--confirm-charge`. It must submit exactly once for the selected model and must not retry a failed submission.

- [ ] **Step 2: Build the minimum payload from the stored contract**

Rules:

1. Use the raw model name from `models.rawName`.
2. Use the protocol’s documented minimum duration; use 4 seconds only when the contract explicitly accepts 4.
3. Use the smallest documented resolution and a documented ratio.
4. Set `generate_audio=false` when the contract allows it.
5. Use text-only content only when the contract allows text-only input.
6. If the contract requires an image, video, or audio asset and no verified fixture exists, return `blocked_missing_fixture` without submission.

- [ ] **Step 3: Poll without resubmitting**

Use bounded query waits such as `5s, 10s, 20s, 40s, 60s`. A transient query error is recorded and retried as a query only. Terminal states are `succeeded`, `failed`, `cancelled`, or `timeout`.

- [ ] **Step 4: Promote only the user's successful test**

A model is `runtime_verified` only when all of these are true:

```text
submit returned a task ID
query used the single-task endpoint
query reached a terminal succeeded state
result contains a non-empty video URL
model.rawName stayed unchanged
```

The command may update the existing binding evidence to `runtime_verified`, protocol state to `active/enabled`, and the selected model’s Variant to public only after the user's task passes these checks. It must write an audit record without the API Key. A successful test belongs only to the selected model; it never promotes sibling models.

- [ ] **Step 5: Test the command without a paid call**

```powershell
pnpm exec tsx --test test-video-release.ts
```

The test must cover:

```text
missing --confirm-charge refuses submission
failed submission never retries
query failure does not create a second submission
success promotes only the selected model
one model failure does not promote sibling models
```

### Task 5: Expose Every Model for User Testing

**Files:**
- Modify: database release states only through the user-triggered command from Task 4
- Update: `VIDEO-RELEASE-REPORT.md`

**Interfaces:**
- Consumes: the 49-row inventory and the user-triggered single-model verification command.
- Produces: one `testable`, `runtime_verified`, or `blocked` result per current video model.

- [ ] **Step 1: Publish free structural readiness**

After free protocol and contract checks, expose every structurally valid model as `testable`, with its required parameters, estimated input requirements, and a visible warning that a real test may consume upstream quota. Do not submit any task during this step.

- [ ] **Step 2: Let the user choose one model**

```powershell
pnpm exec tsx --env-file=.env src/scripts/verify-memefast-video-release.ts `
  --model "<raw-model-name>" `
  --confirm-charge
```

The user chooses the model and explicitly starts the test. OpenHub never loops through all 49 models, never parallelizes video tests, and never submits a second task automatically.

- [ ] **Step 3: Apply the user-owned release decision**

```text
complete contract + no real user test → testable
runtime_verified + complete contract → released
missing fixture or missing operation → blocked
upstream rejected request → test_failed
quota/timeout/network error → operator_action_required, not released
```

Models sharing a protocol still require their own model name to appear in the protocol contract or to have a separate runtime success. A successful `doubao-seedance-2-0-fast-260128` test does not release `veo_3_1`, `kling-video`, or any other model.

- [ ] **Step 4: Stop on unsafe state**

Stop the matrix if any of these occurs:

- the protocol source changes during the run;
- a response returns a task ID but no queryable task;
- a result URL is missing;
- the command would need to submit the same model twice;
- a model would be public without a runtime result.

Do not treat insufficient quota as a software failure. Show the user the upstream error and leave the model in `testable`.

### Task 6: Validate OpenHub’s Public Surface

**Files:**
- Modify: no source files
- Update: `VIDEO-RELEASE-REPORT.md`

**Interfaces:**
- Consumes: released Variants and a temporary OpenHub Key that remains valid until all task records are inspected.
- Produces: final public model count, per-model task evidence, and proof that blocked models remain hidden.

- [ ] **Step 1: Use the user's OpenHub Key**

The user supplies or selects the OpenHub Key used for the test. Do not create hidden test Keys or delete the user's Key. If a temporary Key is used, revoke it only after its task records are terminal; deleting a Key cascades its task records.

- [ ] **Step 2: Verify `/v1/models`**

Check that:

```text
released video models are present
blocked video models are absent
model IDs equal raw Variant names
the upstream MemeFast Key is not exposed
```

- [ ] **Step 3: Submit one final task through OpenHub**

Use one already released model, then verify:

```text
OpenHub task: pending → processing → completed
site task ID is retained
query path is the single-task path
result.video_url is retained
```

- [ ] **Step 4: Inspect the failed-model boundary**

Call a blocked model through the same OpenHub Key. Expected: a controlled `model_not_ready` or equivalent response, with no upstream generation request.

- [ ] **Step 5: Run the full local suite**

```powershell
pnpm test
pnpm typecheck
pnpm --dir ../web build
```

Expected: all tests pass and the public list matches the release report.

### Task 7: Record Completion or Roll Back

**Files:**
- Update: `COMPLETION_STATUS.md`
- Create: `VIDEO-RELEASE-REPORT.md`
- Use: `backups/video-full-release-before-<timestamp>/`

**Interfaces:**
- Consumes: Task 5 and Task 6 evidence.
- Produces: an honest completion state and a tested rollback path.

- [ ] **Step 1: Mark completion only from counts**

The report must state:

```text
video_models_total
released_count
blocked_count
failed_count
runtime_verified_count
protocol_records_used
models_not_tested
```

“全量放行完成” is valid only when `released_count == video_models_total` and every row has terminal success evidence. Otherwise state the exact remaining count and reasons.

- [ ] **Step 2: Revoke temporary test access**

Revoke the temporary OpenHub Key after all task records are inspected. Do not place either upstream or OpenHub raw Key in the report.

- [ ] **Step 3: Execute rollback rehearsal if any gate failed**

```powershell
# Stop the backend first.
Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess |
  ForEach-Object { Stop-Process -Id $_ -Force }

# Restore the database and source files from the exact backup directory.
Copy-Item "<backup>/openhub.db" "packages/server/data/openhub.db" -Force
Copy-Item "<backup>/source/*" "packages/server/src/engine/" -Force
```

Restore route files individually when they were included in the backup, start the backend, then verify `/health`, `/v1/models`, and that video models are hidden again.

- [ ] **Step 4: Final verification**

```powershell
pnpm test
pnpm typecheck
```

## Release Decision

This plan is the correct path for urgent full release because it prepares all 49 models without making the project pay for a blind test matrix, while preserving the only reliable boundary:

```text
discovered ≠ contract-ready
contract-ready ≠ runtime-verified
user-triggered runtime-verified = eligible for publication
```

OpenHub pays zero for discovery, synchronization, matching, and structural checks. The user pays only when deliberately testing a selected model. A model can be fully prepared and shown as `testable` without being falsely labeled `runtime-verified`.
