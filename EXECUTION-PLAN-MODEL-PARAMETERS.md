# 模型参数画像修正实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or execute this plan task-by-task with a review checkpoint after each task. Steps use checkbox syntax for tracking.

**Goal:** 修复模型重新同步后旧参数残留的问题，并让 OpenHub 目录承担“高置信基础画像补全与人工复核入口”，但不冒充供应商的可执行参数合同。

**Architecture:** 继续复用现有 inferModelCapability、目录匹配、model-contract、param-mapper、向导和变体系统。同步时先从本次上游结果重建完整的站点模型画像，再由目录补充身份和基础限制；只有已确认 Schema、运行时明确元数据或管理员确认的数据才可进入运行时合同。

**Tech Stack:** TypeScript、现有 Drizzle SQLite、Node 22、原生 node:test、现有 Vite 本地网页。

## Global Constraints

- 不新增 parameterSource 或通用插件框架；复用现有 catalogMatch*、schemaMatch*、modality* 和 capsOverridden 字段。
- 不把目录数据直接用于 provider 参数校验、必填字段校验或变体可执行限制。
- 不把未知模型默认成 llm；没有证据时必须保持 unknown。
- 重新同步必须是完整画像重建，不允许只补字段。
- capsOverridden=1 的能力与限制字段不被自动同步覆盖。
- schemaMatchStatus=confirmed 的 Schema 快照和合同语义不被目录或普通发现流程覆盖。
- 不在本任务实现 MemeFast 原生视频提交、轮询、回调、上传或任意路径执行。
- 不安装 Visual Studio C++ Build Tools，不提交、不推送、不创建 PR。
- 所有服务端验证使用 Node 22；本地网页验证使用现有 localhost:5173 流程。

---

## 0. 独立分析

### 已确认事实

1. models 表同时保存模态、能力、LLM 限制、媒体限制、Schema 快照和目录关联。
2. packages/server/src/engine/discover.ts 更新已有模型时，当前只可靠更新模态、能力标签和流式状态，未完整清理旧的 LLM/媒体字段。
3. packages/server/src/engine/infer.ts 的名称规则仍包含未经上游确认的默认值，例如 128000 上下文、函数调用、图片尺寸、视频时长和异步状态。
4. packages/server/src/lib/model-contract.ts 已按 schemaMatchStatus=confirmed 限制 Fal 字段合同；candidate 不应成为执行合同。
5. packages/server/src/engine/catalog/match-after-discover.ts 当前主要保存目录关联和目录模态，没有完成基础画像合并。
6. 真实 MemeFast 已发现 467 个模型；当前分类统计包含 audio、embedding、image、llm、unknown、video，说明“未知”是必要状态而不是异常。

### 合理推测

1. OpenHub 的实际价值不是再维护一份供应商模型清单，而是把上游模型名、目录知识、站点实例和可执行合同连接起来。
2. 目录可以安全补全厂商、系列、模态、上下文和输出上限等基础画像；但目录无法证明某个 MemeFast 账户真的开放了该能力或接受该参数。
3. 不新增逐字段来源列也可以完成 P0：运行时合同继续只读取已确认 Schema；目录字段在页面标记为建议，人工能力由 capsOverridden 保护。

### 未验证假设

1. MemeFast 部分模型的 model_type、supported_endpoint_types 和 tags 是否长期稳定，仍需通过后续同步样本观察。
2. 目录的 contextLimit、outputLimit、toolCall 和 reasoning 是否适合所有中转站的同名模型，不能在没有站点证据时视为硬限制。
3. 当前未验证的字段必须通过真实运行时元数据、已确认 Schema 或人工确认升级，不能靠继续堆关键词解决。

### 结论

本次只修三件事：删除不可靠默认值、按本次同步完整重建站点画像、让目录只做有标记的基础补全。这样既能解决 MemeFast 的残留参数，也能让后续供应商复用同一套边界。

---

## 1. 产品边界与验收口径

### P0 必须完成

- MemeFast 重新同步后，模型画像只反映本次已知证据。
- embedding 不再带旧的 contextWindow、函数调用或视觉能力。
- video/audio/image 不再带旧的 LLM 限制。
- requiresAsync 只在明确证据存在时为真，不由模态名称自动推断。
- 高置信目录命中后，补充厂商、family、模态和可作为建议展示的基础限制。
- 目录候选、低置信目录命中和未确认 Schema 不进入运行时参数合同。
- 人工能力覆盖与 confirmed Schema 在重复同步后保持不变。
- 管理页面能区分 MemeFast 原生、Schema、目录、名称规则和未确认。

### 明确不做

- 不为 467 个模型全部猜测成五种已知模态。
- 不继续扩张供应商关键词表来替代运行时元数据。
- 不让 models.dev 或其他目录决定站点是否真的支持某个 endpoint。
- 不把目录参数直接转成 provider_options 或自动参数映射。
- 不新增数据库队列、缓存、插件系统、通用工作流或第二套模型任务系统。

### 最小验收场景

    旧记录：modality=llm，contextWindow=128000，supportsFunctionCalling=1
    本次上游：model_type=embedding
    结果：modality=embedding，endpointCaps=["embedding"]
          contextWindow=null，maxOutputTokens=null
          supportsReasoning=0，supportsFunctionCalling=0，supportsVision=0

    旧记录：modality=llm，capsOverridden=1
    本次上游：model_type=video
    结果：保留人工模态、能力和限制；只更新同步状态与站点可见性

    目录命中但 Schema 为 candidate
    结果：页面显示目录建议；readModelInputContract 返回空的 Fal 字段合同

---

## 2. 文件范围

- Modify: packages/server/src/engine/infer.ts
  - 删除名称规则中未经证实的限制和调用方式默认值。
  - 保留模态、身份和明确能力标签推断。
- Modify: packages/server/src/engine/discover.ts
  - 统一构建本次同步的完整派生画像。
  - 更新已有站点模型时清理模态不相关字段。
  - 保留人工覆盖和 confirmed Schema。
- Modify: packages/server/src/engine/catalog/match-after-discover.ts
  - 读取完整目录基础字段。
  - 只在低优先级字段为空或未知时进行高置信补全。
- Modify: packages/server/src/routes/admin/sites.ts
  - 保证发现、Schema 匹配、目录匹配的执行顺序不会让低优先级目录阻断 Schema 识别。
- Modify: packages/server/test-memefast-modality.ts
  - 锁定没有证据时不产生虚假限制。
- Create: packages/server/test-model-profile-sync.ts
  - 测试完整画像重建和旧字段清理。
- Modify: packages/server/test-model-contract.ts
  - 锁定目录候选不能成为执行合同。
- Modify: packages/server/package.json
  - 将新回归测试纳入 server test。
- Verify or minimally modify: packages/web/src/pages/Models.tsx
  - 显示画像来源和“建议/已确认”边界，不新增第二套状态字段。

不修改数据库结构，不新增迁移文件。

---

## 3. 执行计划

### Task 1：删除名称规则的虚假参数默认值

**Files:**

- Modify: packages/server/src/engine/infer.ts
- Modify: packages/server/test-memefast-modality.ts

**Produces:**

- inferModelCapability 的 keyword 结果只包含有证据的 modality、endpointCaps、paramCaps、vendor、family 和 version。
- runtime metadata 中明确提供的 context_window、function_calling、vision、stream 和 async 信息仍可保留。

- [ ] Step 1: 先补充回归断言

在 test-memefast-modality.ts 增加以下断言：

    const llm = await inferModelCapability("gpt-4o");
    assert.equal(llm.modality, "llm");
    assert.equal(llm.llm?.contextWindow, undefined);
    assert.equal(llm.llm?.supportsFunctionCalling, undefined);

    const image = await inferModelCapability("flux-image");
    assert.equal(image.image?.supportedSizes, undefined);

    const video = await inferModelCapability("kling-video");
    assert.equal(video.video?.maxDurationSec, undefined);
    assert.equal(video.video?.requiresAsync, undefined);

- [ ] Step 2: 运行单文件测试确认当前行为暴露问题

运行：

    pnpm --filter @openhub/server exec tsx --test test-memefast-modality.ts

当前若因旧默认值失败，失败必须来自上述断言，不修改无关测试。

- [ ] Step 3: 删除 keyword 分支中的未经证实默认值

在 infer.ts 中：

- 删除 LLM keyword 分支的 128000、supportsFunctionCalling=true 和其他未经确认限制。
- 删除 image keyword 分支的默认 supportedSizes。
- 删除 video keyword 分支的默认 maxDurationSec、supportedResolutions 和 requiresAsync=true。
- 保留明确的 modality 和最基本 endpointCaps；keyword 不证明真实站点可调用。
- 将 runtime video 的 requiresAsync 改为只读取明确的 runtime async/queue 字段，不由 video_generation 标签直接设置。

- [ ] Step 4: 运行分类测试

运行：

    pnpm --filter @openhub/server exec tsx --test test-memefast-modality.ts

预期：测试通过；runtime 分类仍正确，keyword 分类不再生成虚假限制，未知模型仍为 unknown。

### Task 2：实现完整派生画像重建

**Files:**

- Modify: packages/server/src/engine/discover.ts
- Create: packages/server/test-model-profile-sync.ts
- Modify: packages/server/package.json

**Produces:**

- 一个最小纯函数 buildDerivedModelProfile(inferred) 或等价的单一映射点。
- discoverModels 对新模型和已有未人工覆盖模型使用同一套字段初始化。

**派生字段规则：**

- 通用字段：modality、modalitySource、modalityConfidence、modalityReason、endpointCaps、paramCaps。
- LLM 字段：contextWindow、maxOutputTokens、supportsReasoning、supportsFunctionCalling、supportsVision。
- 图片字段：supportedSizes。
- 视频字段：maxDurationSec、maxReferenceImages、maxReferenceVideos、maxReferenceAudios、requiresAsync。
- 调用方式：supportsStream。
- 不在通用重建函数中修改 schemaEndpointId、schemaMatch*、fal* 和已确认 Schema 的参数快照。

- [ ] Step 1: 写纯函数回归测试

在 test-model-profile-sync.ts 测试：

    const profile = buildDerivedModelProfile({
      modality: "embedding",
      endpointCaps: ["embedding"],
      paramCaps: [],
      classificationSource: "runtime",
      classificationConfidence: "high",
      classificationReason: "MemeFast model_type: embedding",
      confidence: 0.98,
    });

    assert.equal(profile.modality, "embedding");
    assert.deepEqual(JSON.parse(profile.endpointCaps), ["embedding"]);
    assert.equal(profile.contextWindow, null);
    assert.equal(profile.maxOutputTokens, null);
    assert.equal(profile.supportsReasoning, 0);
    assert.equal(profile.supportsFunctionCalling, 0);
    assert.equal(profile.supportsVision, 0);
    assert.equal(profile.supportedSizes, null);
    assert.equal(profile.maxDurationSec, null);
    assert.equal(profile.requiresAsync, 0);

    const video = buildDerivedModelProfile({
      modality: "video",
      endpointCaps: ["video_generation"],
      paramCaps: [],
      classificationSource: "runtime",
      classificationConfidence: "high",
      classificationReason: "MemeFast model_type: video",
      confidence: 0.98,
      video: { requiresAsync: false },
    });

    assert.equal(video.contextWindow, null);
    assert.equal(video.supportsFunctionCalling, 0);
    assert.equal(video.maxDurationSec, null);
    assert.equal(video.requiresAsync, 0);

- [ ] Step 2: 运行测试确认函数尚未存在或旧逻辑不完整

运行：

    pnpm --filter @openhub/server exec tsx --test test-model-profile-sync.ts

- [ ] Step 3: 在 discover.ts 增加单一派生字段映射

实现以下不变量：

- 每次重建先得到完整空画像，再按 inferred 的明确字段填充。
- 不属于当前 modality 的字段明确写 null 或 0。
- unknown 的 endpointCaps 和 paramCaps 必须为空。
- supportsStream 只由明确 stream 证据或现有已验证路径产生；不由 unknown、image、audio、video 自动置真。
- requiresAsync 只由明确 async/queue 证据产生。
- 新模型和已有模型不能使用两套不同的字段初始化逻辑。

- [ ] Step 4: 替换已有模型的局部更新

对 adapterSource=site 且 capsOverridden=0 的已有模型：

- 重新调用 inferModelCapability，并将完整派生画像写回。
- 不保留旧的 contextWindow、maxOutputTokens、supportsFunctionCalling、supportsVision、supportedSizes、maxDurationSec、requiresAsync 等字段。
- 仍更新 status、statusReason、syncedAt、updatedAt。

对 capsOverridden=1 的模型：

- 不更新 modality、endpointCaps、paramCaps 以及管理员可编辑的能力/限制字段。
- 仍更新站点同步状态和同步时间。

对 adapterSource=manual 的模型：

- 不改变人工 adapter 归属。
- 不通过发现流程把其路由切回站点 adapter。

- [ ] Step 5: 将回归测试纳入 server test 并运行

在 packages/server/package.json 的 test 脚本中加入 test-model-profile-sync.ts，运行：

    pnpm --filter @openhub/server exec tsx --test test-model-profile-sync.ts
    pnpm --filter @openhub/server test

预期：已有连接器、分类、合同和参数映射测试仍通过。

### Task 3：让目录补全基础画像，但不升级执行合同

**Files:**

- Modify: packages/server/src/engine/catalog/match-after-discover.ts
- Modify: packages/server/src/routes/admin/sites.ts
- Modify: packages/server/test-model-profile-sync.ts
- Modify: packages/server/test-model-contract.ts

**目录可补全字段：**

- vendor：modelCatalog.labName。
- family：modelCatalog.family。
- modality：仅使用明确 modalitiesOut；只有当前 modality 为 unknown 或低优先级 keyword 时才可写入。
- contextWindow：modelCatalog.contextLimit。
- maxOutputTokens：modelCatalog.outputLimit。
- supportsReasoning：仅当目录字段明确为 true/false 时作为建议显示。
- supportsFunctionCalling：仅当 toolCall 明确时作为建议显示。
- supportsVision：由明确 modalitiesIn 包含 image 推导为目录建议。

**目录不得自动写入或覆盖：**

- endpointCaps、paramCaps。
- requiresAsync、maxDurationSec、supportedSizes。
- confirmed Schema 快照、Schema 合同字段和人工覆盖字段。

- [ ] Step 1: 扩展目录匹配查询并保留匹配证据

匹配后同时读取 labName、family、contextLimit、outputLimit、reasoning、toolCall、modalitiesIn、modalitiesOut；继续保存 catalogModelId、catalogMatchSource、catalogMatchConfidence、catalogSyncedAt。

低置信匹配只保存关联和建议状态，不把目录值写入可执行能力字段。

- [ ] Step 2: 实现高优先级保护规则

目录写入前按以下顺序判断：

    capsOverridden=1
      -> 不写能力和限制
    modalitySource=runtime 或 schema
      -> 不用目录覆盖 modality
    schemaMatchStatus=confirmed
      -> 不用目录覆盖 Schema 合同字段
    catalogMatchConfidence=high 且目标字段为空/未知
      -> 只补基础画像
    其他情况
      -> 只保留目录关联和页面建议

对于历史旧数据，Task 2 的完整重建先清除关键词产生的旧默认值，避免目录合并时把旧值误认为高优先级事实。

- [ ] Step 3: 调整发现后的执行顺序

站点发现流程保持同一条链路：

    discoverModels
      -> matchSchemasForSite
      -> matchModelsForSite

Schema 先确定已确认/候选状态，目录后补全基础画像；目录匹配失败时清除非人工模型的旧 catalogModelId 和目录建议字段。

- [ ] Step 4: 加入合同边界测试

在 test-model-contract.ts 增加：

    const candidate = { ...model, schemaMatchStatus: "candidate" };
    assert.deepEqual(readModelInputContract(candidate).fields, []);
    assert.equal(readModelInputContract(candidate).maxReferenceImages, null);

再验证目录字段即使存在，也不能让 candidate 产生 requiredFields 或 enum：

    const catalogAssisted = {
      ...candidate,
      catalogModelId: "openai/gpt-5",
      catalogMatchConfidence: "high",
      contextWindow: 200000,
      supportsFunctionCalling: 1,
    };
    assert.deepEqual(readModelInputContract(catalogAssisted).fields, []);

- [ ] Step 5: 运行目录和合同测试

运行：

    pnpm --filter @openhub/server exec tsx --test test-model-contract.ts test-model-profile-sync.ts

预期：目录能补全展示画像，但不会改变 model-contract 的已确认 Schema 边界。

### Task 4：页面显示“事实、建议、待确认”

**Files:**

- Verify or minimally modify: packages/web/src/pages/Models.tsx
- Verify or minimally modify: packages/server/src/routes/admin/models.ts

- [ ] Step 1: 确认 API 返回来源字段

模型列表和详情必须返回：

- modality、modalitySource、modalityConfidence、modalityReason。
- catalogModelId、catalogMatchSource、catalogMatchConfidence。
- schemaMatchStatus、schemaMatchConfidence、schemaMatchReason。
- capsOverridden。

- [ ] Step 2: 固定页面文案和显示逻辑

页面必须显示：

- MemeFast 原生：运行时元数据直接分类。
- Schema：已确认 Schema 结果。
- 目录建议：目录命中但不能证明站点执行能力。
- 名称规则：仅名称推断。
- 待确认：unknown 或低置信结果。

未确认 Schema 的参数区显示“仅建议，未作为调用合同”；unknown 模型不显示为可调用 LLM，也不自动创建变体。

- [ ] Step 3: 运行前端构建

运行：

    pnpm --filter @openhub/web build

预期：旧数据、新增 unknown 数据和目录未命中数据均可正常渲染。

### Task 5：本地网页和真实 MemeFast 验收

**Files:**

- No new production files.
- Use the local database at packages/server/data/openhub.db only for verification.

- [ ] Step 1: 使用 Node 22 启动后端和前端

后端使用：

    C:\Users\Administrator\AppData\Local\Temp\openhub-node22

不要在启动命令、日志或浏览器控制台输出 API Key。

- [ ] Step 2: 执行最小测试集

运行：

    pnpm --filter @openhub/server exec tsx --test test-memefast-modality.ts
    pnpm --filter @openhub/server exec tsx --test test-memefast-adapter.ts
    pnpm --filter @openhub/server exec tsx --test test-model-profile-sync.ts
    pnpm --filter @openhub/server test
    pnpm --filter @openhub/web build

- [ ] Step 3: 在本地网页重新同步 MemeFast

打开：

    http://localhost:5173/admin/sites

对现有 MemeFast 站点执行重新发现，确认接口返回 discovered、updated、offline、matched、schemaMatched 等统计，不出现持续“保存中”。

- [ ] Step 4: 核验真实模型画像

至少检查：

- text-embedding-3-small 或同类 Embedding 模型：modality=embedding，LLM 限制为空或 0。
- kling-audio、speech-* 或同类音频模型：modality=audio，不带视频/LLM 默认限制。
- wan2.6-i2v 或同类视频模型：modality=video；requiresAsync 只有明确证据时才为真。
- ERNIE-3.5-8K 或同类无明确元数据模型：保留 unknown 或明确来源的结果，不强行标记为 llm。

- [ ] Step 5: 核验覆盖保护和合同边界

使用本地测试数据验证：

- 人工修改 modality、endpointCaps 或 paramCaps 后再次同步，值保持不变。
- confirmed Schema 后再次同步，Schema 快照和合同仍存在。
- candidate Schema 不产生运行时 requiredFields、enum 或媒体限制。
- 目录命中但没有上游证据时，页面显示目录建议而不是“已支持”。
- 未发现的站点模型变为 offline，不与 modality=unknown 混淆。

- [ ] Step 6: 检查工作树

确认没有：

- API Key、请求头或完整请求体进入日志、测试快照或提交文件。
- 新增无必要的依赖、数据库字段、迁移、队列或插件框架。
- 与模型参数修正无关的 UI、路由或适配器改动。

不提交、不推送、不创建 PR。

---

## 4. 完成定义

- [ ] 重新同步会完整重建未人工覆盖的站点模型画像。
- [ ] 跨模态旧字段残留被清除。
- [ ] 未确认的名称规则不再伪造上下文、工具调用、尺寸、时长或异步能力。
- [ ] OpenHub 目录能补充高置信基础画像，并在页面明确标为建议。
- [ ] 目录和 candidate Schema 不改变运行时合同。
- [ ] 人工覆盖和 confirmed Schema 经重复同步保持不变。
- [ ] MemeFast 真实站点在本地网页完成重新同步验证。
- [ ] server 测试与 web 构建通过。

## 5. 计划外延

只有在真实运行数据证明 P0 仍不足时，才单独制定后续计划：

- MemeFast 原生媒体接口需要 provider-specific 参数映射时，新增一个明确边界的 adapter operation。
- 需要完整参数百科时，扩展独立的 Schema/参数知识库，不把它塞进 models 表的隐式字段。
- 需要多租户终端用户 Key 时，另建凭据租户设计，不复用当前管理员站点 Key。

本计划执行后的 OpenHub 定位保持清晰：站点模型实例负责“这个站点实际发现了什么”，目录负责“这个模型通常是什么”，Schema/人工确认负责“现在允许调用什么”。
