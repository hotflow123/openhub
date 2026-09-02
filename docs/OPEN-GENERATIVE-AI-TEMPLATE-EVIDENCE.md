# Open-Generative-AI 参数模板证据

同步脚本读取 `Open-Generative-AI/packages/studio/src/models.js`，生成 `packages/catalog/data/open-generative-ai.snapshot.json`。快照记录源提交号、源文件 SHA256、集合名、数组索引、许可和快照 SHA256。

当前基线（2026-09-01）：8 组数组、439 条记录、128 个不同输入字段；源提交 `c90e9080fcf48a5b31757a01dcae37b544ff0612`。

该数据是参数表单和变体限制候选，不是供应商执行合同。`endpoint` 仅保存为 `endpointHint`；真实 URL、鉴权、提交/查询和结果解析仍由已审查适配器负责。模板候选不会改变模型运行时 `ready` 状态，未验证能力继续由 `409 capability_unverified` 门禁拦截。

已知限制：源数组结构变化时同步失败；MemeFast 是否接受某字段必须由适配器证据确认；音频操作保留源操作，不自动归类为 TTS。

## 闭环状态（2026-09-01）

- 快照从 `packages/server` 启动目录可加载，并把候选写入 `model_parameter_templates`；重复同步使用唯一键幂等更新。
- 视频模板只在 Variant 的 `adapterConfig.video.protocol` 明确选择且通过身份、操作、字段映射检查后才可应用。
- 应用模板必须绑定具体 Variant；模型级“全局应用”接口会拒绝，运行时也会拒绝未处于 `applied` 状态的绑定。
- 模板默认值进入现有参数合并链，Variant 的显式映射可以覆盖模板映射；未声明的供应商私有字段不会自动改名或发送。
- 这证明的是本地闭环和 fixture 行为，不等于每个供应商的真实计费请求都已验收。
