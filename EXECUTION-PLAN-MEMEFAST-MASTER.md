# OpenHub New API 上游适配与 MemeFast 协议补全执行计划

> 状态：协议盘点、导入、模型绑定已完成；已确认“模型已发现但未自动暴露为 Variant”是当前直接集成的主要阻塞；真实媒体生成调用仍未验证  
> 原则：先核实证据，再修改源码；每一步都有可运行的验收检查。  
> 本计划取代 `EXECUTION-PLAN-MEMEFAST-CONNECTOR.md`，并将 New API 兼容中转站作为主目标，MemeFast 作为首个真实站点样本。

## 1. 明确目标

OpenHub 的核心不是展示模型名称，而是：

```text
New API/MemeFast 只暴露基础模型入口
        ↓
OpenHub 保存 MemeFast 协议模板
        ↓
OpenHub 套用 Fal / Open-Generative-AI 参数模板
        ↓
OpenHub 做字段映射、参数校验和请求转换
        ↓
下游网站或软件使用统一接口
```

最终下游只需要：

```text
OpenHub 地址 + OpenHub Key + 原始模型名
```

OpenHub 负责：

- 保存并管理 MemeFast 文档中确认过的协议。
- 保存模型参数模板和完整 Schema。
- 把参数模板绑定到站点原始模型名。
- 将标准参数映射为 MemeFast 实际请求。
- 处理同步响应和视频等异步任务。
- 向下游返回稳定、统一的结果。

## 2. 当前证据结论

当前仓库已经存在：

- `model_schema_catalog`：保存 Fal 参数 Schema。
- `model_schema_alias`：保存模型名到 Fal endpoint 的别名。
- `models`：保存站点发现的原始模型和部分能力。
- `variants`：保存参数覆盖、限制和字段映射。
- LLM、图片、音频、视频基础适配器。
- 视频任务提交、查询、超时和回调骨架。

当前明确缺失：

- 独立的 MemeFast 协议目录。
- MemeFast 各协议的版本、操作、请求格式、响应格式和状态映射持久化。
- MemeFast 文档持续同步、版本差异和新旧协议共存机制。
- 模型到 MemeFast 协议的正式绑定记录。
- Fal 参数模板到 MemeFast 请求协议的正式映射层。
- “协议已保存”“模板已套用”“真实调用成功”的分层状态。

代码层面还存在两个直接风险：

- `packages/server/src/engine/discover.ts` 仍直接拼接 `/v1/models`，没有把全部发现行为交给站点适配器。
- `packages/server/src/engine/param-mapper.ts` 存在按白名单处理字段的路径，可能把模板参数静默丢弃。

因此，当前问题不是再增加几个模型别名，而是补齐：

```text
协议目录 → 参数模板 → 模型绑定 → 请求映射 → 执行证据
```

## 3. 不改变的核心规则

### 3.1 模型名称

- 保留 MemeFast 返回的原始模型名。
- 下游继续使用例如 `seedance2.0`、`veo_3_1` 等原名。
- `memefast.video.v1` 只能是内部协议模板 ID，不能成为下游模型名。
- 不自动改名，不用某一个模型写专用硬编码。

### 3.2 Fal 参数模板

Fal 参数模板不是废弃项，也不是只用于展示：

```text
Fal / Open-Generative-AI
        = 参数与能力模板来源

MemeFast 协议
        = 请求路径、请求封装、响应和任务生命周期来源

OpenHub 映射
        = 把模板参数真正转换成 MemeFast 请求
```

如果 MemeFast 已真实支持对应参数，OpenHub 必须允许：

- 用户修改比例。
- 用户修改分辨率。
- 用户修改时长。
- 用户修改参考图片、视频、音频数量。
- 用户修改模板中定义的其他合法参数。

只要目标协议和模型能力允许，就不能因为参数来自 Fal 模板而回退或拒绝。

### 3.3 安全重试

- 视频、图片等可能产生费用的创建请求不自动重试。
- 用户可以显式发起重试。
- 查询任务、回调通知、健康检查可以有限重试。
- 没有确认幂等语义时，不重复提交生成任务。

## 4. 目标架构

```text
下游网站/软件
    ↓ OpenHub Key
OpenHub 统一 API
    ↓
模型原名解析
    ↓
模型能力绑定
    ↓
协议模板绑定
    ↓
参数模板解析
    ↓
字段映射与请求构造
    ↓
MemeFast Adapter
    ↓
MemeFast / New API
    ↓
响应转换
    ↓
统一结果
```

媒体异步任务：

```text
创建任务
→ 保存 OpenHub task
→ 提交 MemeFast
→ 保存上游 task id
→ 查询 MemeFast 状态
→ 映射 pending / processing / completed / failed
→ 保存结果或错误
→ 下游查询任务
```

## 5. 数据模型最小方案

不把协议继续塞进 `adapter_config` 或 Fal Schema 快照中。新增两张最小表。

### 5.1 `protocol_catalog`

保存 MemeFast 已知协议的正典描述：

```text
id
version
name
source
source_docs
modality
operations
request_contract
response_contract
status_mapping
parameter_mapping
evidence_status
enabled
created_at
updated_at
```

`operations` 至少能描述：

```text
operation_id
method
path
request_kind
response_kind
async
required_fields
optional_fields
```

### 5.2 `model_protocol_bindings`

保存站点模型与协议的实际绑定：

```text
id
model_id
protocol_id
parameter_template_id
field_mapping
capability_overrides
evidence_status
binding_reason
created_at
updated_at
```

现有 `model_schema_catalog` 继续保存 Fal 参数模板；不迁移、不删除。

## 6. 证据状态

协议、参数模板和模型绑定分别记录状态，不能混成一个“正常”。

```text
documented
→ imported
→ fixture_verified
→ runtime_verified
→ enabled
```

含义：

- `documented`：在 MemeFast 文档中找到。
- `imported`：已保存进 OpenHub。
- `fixture_verified`：请求和响应 Fixture 可解析。
- `runtime_verified`：真实请求成功过。
- `enabled`：允许下游调用。

最终可执行条件：

```text
协议 enabled
+ 参数模板存在
+ 模型绑定存在
+ Adapter 支持对应操作
```

模型名称识别成功本身不能让模型变成可执行。

## 7. 执行阶段

### Phase 0：冻结基线

- [ ] 备份将要修改的文件。
- [ ] 记录当前 Git 状态，不清理用户已有修改。
- [ ] 使用 Node 22 运行现有类型检查和测试。
- [ ] 统计当前 Fal Schema、模型、变体、适配器和视频任务数量。
- [ ] 修正文档中“100% 完成”的高估表述。

验收：

```text
有基线报告、备份清单、当前测试结果和当前缺口列表。
```

### Phase 1：完整盘点 MemeFast 协议

- [ ] 读取 MemeFast 文档目录和 Reference 页面。
- [ ] 建立“文档页面 → 协议操作 → 模态 → 请求/响应”的清单。
- [ ] 明确哪些是通用 OpenAI 兼容协议。
- [ ] 明确哪些是图片、视频、音频原生协议。
- [ ] 明确哪些协议包含创建、查询、回调、上传、下载或编辑操作。
- [ ] 记录每个协议的版本和原始文档证据。
- [ ] 对文档中未确认的路径、字段和状态保持空缺，不猜测。

输出：

```text
MEMEFAST-PROTOCOL-INVENTORY.md
```

验收：

```text
每个协议都有文档来源、操作列表和未确认项。
```

### Phase 1.5：持续读取最新协议

一次性读取只能建立初始快照，不能保证覆盖 MemeFast 后续新增或修改的协议。

- [x] 建立受信任的 MemeFast 文档源清单，不扫描任意 URL。
- [x] 每次同步记录文档 URL、抓取时间、内容哈希和来源版本。
- [x] 读取文档目录页、Reference 索引和明确标注的最新版本页面。
- [x] 对新增页面、路径变化、字段变化和状态变化生成差异报告。
- [ ] 支持手动同步；部署环境增加每日后台同步。
- [x] 同步失败时保留上一次可用协议，不清空现有数据。
- [x] 新协议先进入 `imported`，不能直接进入 `enabled`。
- [ ] 文档变化但契约未验证时标记为 `changed`，不覆盖旧版本。
- [ ] 文档声明旧协议废弃时标记为 `deprecated`，不删除已有绑定。
- [ ] 新模型优先绑定最新的 `fixture_verified` 或 `runtime_verified` 版本。
- [ ] 旧模型继续使用原绑定版本，直到管理员确认迁移。

协议版本规则：

```text
协议 ID 相同、版本不同 = 两条独立记录
旧绑定不自动迁移
新版本未验证时继续使用旧版本
```

最小同步记录：

```text
source_url
fetched_at
content_hash
source_version
previous_hash
diff_status
```

同步结果至少包含：

```text
新增协议
更新协议
废弃协议
未解析页面
同步失败原因
```

验收：

```text
模拟新增协议：同步后进入 imported。
模拟字段变化：旧版仍可查询，新版单独保存并生成差异。
模拟同步失败：旧协议和现有模型绑定不受影响。
```

当前未完成：官方文档实时抓取仍受 HTTPS 环境影响；HTML 页面只有在提供显式 JSON manifest 时才会导入，普通自然语言文档不会被猜测成协议。

### Phase 2：保存协议目录

- [ ] 新增 `protocol_catalog` Schema。
- [ ] 新增 `model_protocol_bindings` Schema。
- [ ] 编写数据迁移并检查不会重建或清空现有模型表。
- [ ] 编写协议导入脚本。
- [ ] 将 Phase 1 清单导入数据库。
- [ ] 保存原始协议 JSON，确保后续可审计。
- [ ] 增加协议版本和来源字段。
- [ ] 增加 `active / deprecated / changed / imported` 生命周期状态。
- [ ] 使用稳定协议 ID 加版本作为唯一标识，禁止用最新内容覆盖旧记录。
- [ ] 保存同步运行的新增、变化、废弃和失败统计。

验收：

```text
文档中的每个已确认协议都能从数据库查询。
协议查询结果包含操作、参数、响应和证据状态。
旧版本绑定仍能查询，新版本不会覆盖旧版本。
```

### Phase 3：吸收参数模板

- [ ] 保留现有 Fal Schema 同步和查询能力。
- [ ] 检查 `Open-Generative-AI` 中可提取的模型参数、默认值、枚举、限制和能力。
- [ ] 将可执行字段转换为 OpenHub 参数模板格式。
- [ ] 为模板保留来源、版本和原始 JSON。
- [ ] 统一记录文本、图片、音频、视频四类参数。
- [ ] 对同名但不同协议的模板分开保存。

重点参数包括：

```text
prompt
negative_prompt
duration
ratio / aspect_ratio
resolution
image_url / image_urls
video_url / video_urls
audio_url / audio_urls
reference media count
seed
steps
guidance
generate_audio
voice
response format
```

验收：

```text
模板能被查询、展示、复制和绑定。
模板字段不会因不在 /v1/models 返回中而被删除。
```

### Phase 4：建立模板到 MemeFast 的映射执行层

- [ ] 定义统一参数名到 MemeFast 参数名的映射。
- [ ] 定义顶层字段、嵌套字段、数组和多模态 `content` 的转换。
- [ ] 定义枚举和值转换。
- [ ] 定义参考媒体数量校验。
- [ ] 定义创建响应中的任务 ID 提取。
- [ ] 定义查询响应中的状态、结果 URL 和错误提取。
- [ ] 定义同步、异步、流式三类响应处理。
- [ ] 未知字段必须返回结构化错误或明确放入 `provider_options`，不能静默丢弃。

映射原则：

```text
模板字段存在
+ 目标协议声明支持
+ 模型绑定没有禁止
= 可以发送
```

不能使用以下错误逻辑：

```text
/v1/models 没返回参数
→ 判定参数不可用
```

### Phase 5：MemeFast Adapter

- [ ] 新增或整理一个统一 `memefast` Adapter。
- [ ] Adapter 只负责认证、传输、请求/响应执行。
- [ ] 协议细节从 `protocol_catalog` 读取，不写死在每个模型分支中。
- [ ] Adapter 支持协议声明的标准操作。
- [ ] 不开放任意 URL、任意 HTTP 方法或任意脚本执行。
- [ ] 保留 OpenHub Key 与 MemeFast Key 的隔离。
- [ ] 所有请求不记录 API Key、完整请求体或媒体内容。

先实现最小通用能力：

```text
models.list
chat
chat.stream
embedding
image.generate
audio.speech
audio.transcription
video.submit
video.query
```

随后按 Phase 1 的真实清单补齐 MemeFast 其他协议操作。

### Phase 6：模型绑定和管理界面

- [ ] 发现模型时保留原始名称。
- [ ] 显示模型当前绑定的协议。
- [ ] 显示当前参数模板。
- [ ] 显示协议证据状态和模板证据状态。
- [ ] 支持管理员选择或更换参数模板。
- [ ] 支持调整比例、分辨率、时长和参考媒体数量。
- [ ] 保存前执行协议字段映射和模板校验。
- [ ] 用户自定义模板不能被无理由回退；只有明确不支持的字段才拒绝。
- [ ] 显示拒绝原因、对应协议字段和来源证据。

UI 状态至少分为：

```text
已发现
协议已保存
模板已绑定
可执行
真实验证成功
缺少协议
缺少模板
映射不完整
真实调用失败
```

### Phase 7：测试和真实验收

- [ ] 每个协议至少有一个请求 Fixture。
- [ ] 每个异步协议至少有 pending、processing、success、failed Fixture。
- [ ] 测试参数映射不会丢失比例、分辨率、时长和参考媒体。
- [ ] 测试错误响应不会暴露 Key。
- [ ] 测试视频创建请求不会自动重复提交。
- [ ] 测试查询和回调失败可有限重试。
- [ ] 选一个低成本视频模型完成一次真实创建和查询。
- [ ] 按协议类别各选少量代表模型真实验收，不逐一批量扣费。

验收链路：

```text
原始模型名
→ 选择已保存协议
→ 套用 Fal / Open-Generative-AI 模板
→ 修改 duration / ratio / resolution / reference media
→ OpenHub 映射请求
→ MemeFast 成功创建
→ 查询任务
→ 返回统一结果
```

## 8. “全部协议”完成定义

这里的“全部”指：

```text
MemeFast 文档公开并确认存在的协议操作
```

不包括：

- MemeFast 未公开的内部接口。
- 仅供应商官方存在、但 MemeFast 没有暴露的接口。
- 没有请求/响应证据的猜测接口。
- 任意用户输入的动态 URL 或脚本。

完成条件：

- 文档清单中的每个协议都有数据库记录。
- 每个协议都有版本、来源和操作定义。
- 同步机制能发现文档新增和变更，并保留旧版本。
- 每个协议都有请求/响应 Fixture。
- 已启用协议都有对应 Adapter 操作。
- 已绑定模型都保留原始模型名。
- Fal / Open-Generative-AI 模板能够参与实际请求构造。
- 至少一个真实模型完成端到端调用。

## 9. 不做的事情

- 不为每个模型写一段硬编码。
- 不把 `memefast.seedance.v1` 作为模型名称暴露给下游。
- 不删除现有 Fal 参数百科。
- 不把 Fal 参数直接当作 MemeFast 协议。
- 不因为 New API 模型列表缺少参数就放弃模板参数。
- 不对所有视频模型自动发起计费测试。
- 不自动重试可能产生费用的创建请求。
- 不新建第二套任务系统。
- 不在没有证据时宣称“所有协议都可用”。

## 10. 最终产品结果

执行完成后，OpenHub 的工作方式是：

```text
管理员添加 MemeFast 地址和 Key
→ OpenHub 保存全部已确认 MemeFast 协议
→ 发现 MemeFast 原始模型
→ 绑定对应协议和参数模板
→ 下游使用原始模型名调用
→ OpenHub 补全 Fal / Open-Generative-AI 参数
→ OpenHub 转换请求
→ MemeFast 执行
→ OpenHub 统一返回
```

最终定位：

> **OpenHub 是 New API/MemeFast 的多模态参数补全、协议适配和统一调用层。**

## 11. 执行纪律

- [ ] 每次修改前备份涉及文件。
- [ ] 每个阶段先做最小测试，再改源码。
- [ ] 每个阶段完成后运行针对性测试。
- [ ] 协议同步不能覆盖已验证的旧版本。
- [ ] 新协议只有经过 Fixture 或真实验证后才能启用。
- [ ] 不覆盖用户已有修改。
- [ ] 不使用 `git reset --hard`、`git clean` 或删除数据库重建。
- [ ] 使用 Node 22 验证，避免 Node 24 与 `better-sqlite3` ABI 冲突。
- [ ] 只有测试和真实证据通过后，才把状态标为 `enabled`。

## 12. New API-first 修订（2026-09-05）

### 12.1 研究结论

本项目不能只围绕 MemeFast 的文档页面打造。New API 的实际接入单位是：

```text
站点 / Channel
    + 上游 Key
    + Channel Type
    + 模型允许列表或模型映射
    + 协议路由
    + 请求、响应、任务状态转换
```

`new-api-plugins` 证明了任务协议不是“模型名 + 几个参数”：

- 插件显式声明 `channelTypes`、`models`、`routes`、`protocols`。
- 任务插件分别实现提交、查询、状态映射、结果提取和用量计算。
- 同一个模型名可能因 Channel Type、路由和协议不同而使用不同请求格式。
- 插件运行在中转站管理员信任边界内，不能把外部 JavaScript 直接加载到 OpenHub 执行。

因此：

```text
New API / 中转站协议 = 上游执行契约
Open-Generative-AI / Fal = 参数与能力模板来源
OpenHub = 模型公开、模板映射、协议执行和统一结果层
```

### 12.2 当前实测阻塞

2026-09-05 启动本地服务后的实测结果：

```text
MemeFast 站点：active，healthCheck=true
发现模型：459
协议记录：96
模型协议绑定：459
Variants：0
带 OpenHub Key 的 /v1/models：0
直接使用原始模型名调用：variant_not_found
```

结论：

```text
发现和协议同步已经工作
模型公开和下游可调用入口没有完成
```

所以第一优先级不是继续增加模型别名，而是把“已确认可执行的模型”安全地公开为 Variant，并保持原始模型名。

### 12.3 不偏离目标的边界

目标仍然是：

```text
用户添加 New API / MemeFast 地址和上游 Key
→ OpenHub 发现模型
→ OpenHub 读取协议和参数模板
→ OpenHub 自动建立可调用模型入口
→ 下游只使用 OpenHub 地址和 OpenHub Key
```

必须明确：

- 上游 Key 只保存在 OpenHub 站点配置中，使用加密存储。
- 下游使用 OpenHub Key，不把 MemeFast Key 或 New API Key 暴露给浏览器和第三方软件。
- 下游默认使用上游原始模型名；只有多个站点出现同名模型时，才使用已有 Variant Group 或明确的冲突策略。
- 不按模型名猜协议，不把 `memefast.*` 或 `newapi.*` 伪装成模型名。
- 不把 Fal 或插件源码直接当作上游执行协议。
- 不允许任意插件脚本、任意 URL 或任意 HTTP 方法执行。
- “模型已发现”不等于“模型已验证可调用”；公开状态必须保留证据等级。

### 12.4 修订后的执行顺序

#### Phase A：先复现并固定当前缺口

- [ ] 保留当前数据库和源码，不清空用户数据。
- [ ] 增加一个最小验收脚本：站点健康、模型数量、协议绑定、Variant 数量、公开模型数量。
- [ ] 固定失败断言：模型数量大于 0 但 Variant 为 0 时，公开 `/v1/models` 不得伪装成可用。
- [ ] 将该脚本纳入服务端测试或可重复的验收命令。

完成标准：

```text
任何人都能一条命令复现“发现成功但下游无模型”的根因。
```

#### Phase B：补齐 New API 站点级接入资料

- [ ] 复用现有 `sites`、`models`、`variants`、协议目录和 Schema 目录，先不新建重复表。
- [ ] 在现有站点配置中补充经过证据确认的 New API Channel Type、模型映射和协议来源；只有现有字段无法表达时才增加字段。
- [ ] 将 `model.rawName` 作为上游实际名称，将 `variant.name` 作为下游公开名称；默认两者相同。
- [ ] 将上游模型映射、参数覆盖、字段映射和协议绑定分开保存。
- [ ] 保留模型的原始站点、原始名称和同步来源，禁止同步时改名。

完成标准：

```text
能够区分“下游公开名”和“上游实际名”，且默认不改名。
```

#### Phase C：自动生成安全的可调用入口

- [ ] 站点同步成功后，对每个模型计算公开资格。
- [ ] 对协议、Adapter、参数模板都满足最低条件的模型，自动创建或更新同名 Variant。
- [ ] 已有人工 Variant 不覆盖，只补齐缺失字段。
- [ ] 无协议、无模板或存在冲突的模型不自动公开，进入待补全清单。
- [ ] 公开模型进入 `/v1/models`；未公开模型只能在管理后台显示。
- [ ] 通过已有 `isPublic` 和证据状态表达“发现但未公开”“可公开”“真实验证成功”，不另造一套状态系统。
- [ ] 同名模型跨站点时优先使用已有 Variant Group；无法安全选择时要求管理员选择，不自动改名。

完成标准：

```text
添加一个真实 New API 站点后，不再需要逐个手工创建 Variant，
下游可以从 `/v1/models` 获取经过资格检查的原始模型名。
```

#### Phase D：吸收 new-api-plugins，但不执行插件源码

- [ ] 将 `new-api-plugins/index.json` 作为模型、Channel Type、协议和版本的来源索引。
- [ ] 从插件 `meta` 提取模型清单、路由、协议声明、版本和完整性哈希。
- [ ] 将插件源码中的请求构造、响应解析、状态映射和用量逻辑转写为受审查的 OpenHub Adapter/协议定义。
- [ ] 每个协议至少保留提交、查询、状态、结果和错误的 Fixture。
- [ ] 插件升级时以新版本记录保存，不覆盖旧版本绑定。
- [ ] 不允许 OpenHub 运行外部 `plugin.js`；插件只作为受信任的协议证据和实现参考。

首批范围：

```text
OpenAI 兼容 LLM / Embedding / 图片 / 音频
OpenAI Video 任务协议
new-api-plugins 已声明的异步视频协议
```

完成标准：

```text
插件清单中的每个已接入协议都有明确的 OpenHub 实现或明确标记为未实现，
不会出现“目录显示支持、运行时却没有提交或查询实现”。
```

#### Phase E：统一请求映射和结果转换

- [ ] 保留现有 Fal / Open-Generative-AI 参数模板。
- [ ] 通过协议绑定把模板字段映射到 New API 实际字段。
- [ ] 支持比例、分辨率、时长以及图片、视频、音频参考数量的变体修改。
- [ ] 不支持的字段返回结构化错误，不静默丢弃。
- [ ] 视频统一处理提交、查询、状态、结果 URL、过期时间和错误。
- [ ] 上游模型名只在发往上游时使用；下游响应继续返回下游请求的模型名。
- [ ] 生成任务不自动重试；查询、健康检查和通知才允许有限重试。

完成标准：

```text
同一套下游请求可以经过 Variant + 协议映射，生成 New API 能接受的真实请求，
而不是仅仅在后台显示“参数已匹配”。
```

#### Phase F：第三方集成验收

- [ ] 服务器端软件使用 `OPENHUB_URL + OPENHUB_KEY` 调用 `/v1/models`。
- [ ] 浏览器网站使用配置过的 CORS 来源调用，不默认开放任意来源。
- [ ] LLM 先用低风险代表模型完成真实请求。
- [ ] 图片、音频、视频按协议各选少量代表模型真实验证，不批量扣费。
- [ ] 视频验证创建后必须能查询到最终状态或明确失败原因。
- [ ] 记录每个公开模型的证据等级、协议版本、模板版本和最后验证时间。
- [ ] 只有通过资格检查的模型才出现在下游公开列表。

最终验收：

```text
添加一个 New API / MemeFast 地址和 Key
→ 自动发现并公开合格模型
→ 下游用 OpenHub Key 获取原始模型名
→ LLM / 图片 / 音频走统一接口
→ 视频走统一提交与查询接口
→ 参数模板可以实际映射并允许合法变体修改
→ 失败模型不会被伪装成正常
```

### 12.5 PR 拆分

为避免把 New API、MemeFast、Fal 和视频任务一次性揉成屎山，按以下顺序提交：

```text
PR 1：公开入口与 New API 站点模型映射
      解决 Variant=0、/v1/models=0、原始模型名保留

PR 2：协议目录与 new-api-plugins 元数据吸收
      只导入受信任的版本、路由、模型和协议声明

PR 3：协议驱动的请求/响应转换
      先 OpenAI 兼容协议，再异步视频协议

PR 4：第三方集成验收与管理后台状态
      CORS、证据状态、验证记录和回归测试
```

不允许在 PR 1 中顺手重写整个目录系统、任务系统或所有供应商 Adapter。

### 12.6 计划完成定义

只有同时满足以下条件，才可宣称达到本轮目标：

- [ ] 仅添加一个 New API / MemeFast 站点地址和上游 Key，就能自动完成模型发现。
- [ ] 合格模型自动生成或更新可调用 Variant，不需要管理员逐个手工创建。
- [ ] 下游 `/v1/models` 能看到原始模型名。
- [ ] 下游只需 OpenHub 地址和 OpenHub Key。
- [ ] 协议模板、参数模板和 Adapter 都有明确绑定。
- [ ] 合法修改比例、分辨率、时长和参考媒体数量不会被无故拒绝。
- [ ] 至少完成 LLM、图片、音频、视频各一个代表协议的真实或可审计验证。
- [ ] 未完成验证的模型明确显示为未验证或不可用，不显示为正常可调用。

## 13. New API 主源码审计后的计划修正（2026-09-05）

> 本节优先于前文同名或冲突条款。修正依据为 `E:\code\openhub\new-api` 主源码，而不是只依据 `new-api-plugins`。

### 13.1 已核实的主源码事实

| 主源码证据 | 对 OpenHub 的直接影响 |
|---|---|
| `model/channel.go`：Channel 同时保存 `Type`、`Key`、`BaseURL`、`Models`、`ModelMapping`、`ParamOverride`、`HeaderOverride`、分组和状态 | OpenHub 必须把站点、公开模型名、上游模型映射、协议和参数模板分开，不能把 Fal endpoint 当作上游模型名 |
| `controller/model.go`：`/v1/models` 从启用的 Ability 和用户分组生成，并受计费配置、Token 模型限制影响 | OpenHub 通过普通上游 Key 能看到的是“该 Key 可见的公开模型”，不是 New API 内部全部 Channel 模型 |
| `controller/channel_upstream_update.go`：普通 Channel 按类型访问模型列表，Task Plugin 直接使用插件 `meta.models` | 不能假设所有模型都来自同一个 `/v1/models` 或同一个供应商端点 |
| `relay/helper/model_mapped.go`：模型映射支持链式跳转和循环检测 | New API 的公开模型名必须原样发送给 New API；映射到供应商真实模型由 New API 自己完成 |
| `pkg/jsplugin/registry.go`、`pkg/jsplugin/routing.go`：插件包含 `channelTypes`、`models`、`routes`、`protocols`、版本、允许主机和用量 Schema | 插件元数据可以作为协议证据，但不能直接当作 OpenHub 的运行时代码 |
| `middleware/task_plugin.go`、`relay/channel/task/jsplugin/adaptor.go`：任务路由先固定插件/协议/模型，再执行提交、查询、状态、结果、用量和产物钩子 | 视频协议不是“找到一个 POST 路径”就完成，必须绑定完整任务生命周期 |

### 13.2 本轮必须修正的目标

OpenHub 的目标改为：

```text
输入：一个 New API/MemeFast 公共地址和上游 Key
      ↓
读取该 Key 实际可见的公开模型
      ↓
保留公开模型原名
      ↓
按 New API 公共协议提供下游兼容接口
      ↓
用 OpenHub 参数目录补全合法参数
      ↓
把请求发回 New API，由 New API 负责其内部 Channel、Key、模型映射和供应商路由
```

不得再把目标表述为：

```text
仅凭普通上游 Key 自动获得 New API 内部所有隐藏 Channel 模型、
所有供应商原始参数和所有插件实现
```

这部分没有公共证据时不可实现，也不应写入完成承诺。

### 13.3 模型身份规则

对 New API 上游，字段语义固定为：

```text
model.rawName          = New API /v1/models 返回的公开模型 ID
variant.name           = OpenHub 下游公开名称，默认与 rawName 完全相同
catalogModelId         = OpenHub 参数百科或 Fal/Open-Generative-AI 模板 ID
protocolBinding        = OpenHub 到 New API 公共请求的协议绑定
```

- 不把 `catalogModelId` 写回 `model.rawName`。
- 不把 `memefast.*`、`newapi.*` 写成下游模型名。
- 不为了区分供应商而自动改名；同名模型的路由交给显式 Variant Group 或管理员选择。
- 只有 OpenHub 未来直接连接供应商时，才另行增加“供应商真实模型名”字段；本轮连接 New API 不提前增加该抽象。

### 13.4 协议绑定规则

协议匹配分成两类，不能混在一起：

1. **New API 公共协议**
   - LLM：`/v1/chat/completions`、`/v1/messages`、`/v1/responses`。
   - 图片：`/v1/images/generations`、`/v1/images/edits`。
   - 音频：`/v1/audio/speech`、`/v1/audio/transcriptions`。
   - Embedding：`/v1/embeddings`。
   - 这些路径由 New API 主源码明确声明，OpenHub 不需要为每个模型猜一个供应商协议。

2. **Task Plugin / 视频协议**
   - 必须保存插件 Key、版本、模型范围、公共路由、提交、查询、状态、结果、产物和用量定义。
   - 必须有 OpenHub 受审查的实现；只有文档或插件源码而没有实现时，标记为 `unimplemented`，不得公开为可调用。
   - 生产运行时禁止使用当前 `memefast.ts` 的关键词挑选操作方式；必须由绑定记录明确指出 `submit`、`query`、`content` 等操作。

### 13.5 对当前实现的直接修复要求

- `GET /v1/models` 只返回 `isPublic=1` 且当前 OpenHub Key 有权限的 Variant，不得返回全部 Variant。
- New API 普通模型不应因为没有 MemeFast 文档协议绑定而被整体拦截；标准公共协议使用固定路由。
- 视频主兼容入口采用 New API 已有的 `/v1/videos`、`/v1/videos/:id`、`/v1/videos/:id/content`；现有 `/v1/video/*` 仅作为兼容入口保留。
- `resolveRoute` 必须同时检查协议记录状态、运行时实现状态、模型模态和 Adapter 能力，不能只判断“存在一条绑定记录”。
- `modelProtocolBindings` 必须记录“协议来源”和“OpenHub runtime implementation”；`documented/imported` 不得直接等于可执行。
- `findOperation` 只能用于导入或诊断候选，不能用于正式转发；正式转发使用显式操作 ID。
- OpenHub 发送给 New API 的 `model` 必须是 `model.rawName`，不能发送 Fal endpoint 或推测出的供应商模型名。

### 13.6 修订后的执行顺序

```text
Phase 0：固定 New API 公共可见性和 Variant=0 回归测试
    ↓
Phase 1：修复 /v1/models 的公开性、Key 权限和原始模型名保留
    ↓
Phase 2：先打通 New API 标准 LLM / 图片 / 音频 / Embedding
    ↓
Phase 3：保存插件元数据与版本，但建立“实现状态”门禁
    ↓
Phase 4：以一个真实视频公共协议完成显式 submit/query/content 实现
    ↓
Phase 5：把 OpenHub 参数模板映射到公共协议字段，并验证合法变体
    ↓
Phase 6：第三方 SDK 按公开接口验收，再扩展其他协议族
```

### 13.7 完成标准修正

本轮达到以下条件才算完成：

- 提供一个 New API/MemeFast 地址和 Key 后，OpenHub 能发现并公开该 Key 实际可见的模型。
- 下游 `/v1/models` 返回 New API 原始模型名，且不泄露上游 Key。
- LLM、图片、音频和 Embedding 至少各有一条 New API 公共协议真实链路。
- 视频至少有一条完整的提交、查询、状态、结果和产物链路。
- Fal/Open-Generative-AI 模板参数能经过字段映射后实际进入 New API 公共请求。
- 未实现、未验证或协议冲突的模型不会显示为可调用。
- 不宣称已经覆盖普通上游 Key 无法看到的隐藏模型、内部 Channel 配置或未实现插件协议。
