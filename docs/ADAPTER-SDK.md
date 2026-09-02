# OpenHub 适配器 SDK

适配器是 OpenHub 服务端受审查的供应商协议实现。SDK 固定类型和合规边界，不提供远程代码执行或任意 HTTP 执行器。

## 必须声明

- `manifest.id`、语义化版本和显示名称
- 支持的模态与能力
- 模型绑定规则及证据
- 协议、鉴权方式、配置 Schema
- 供应商文档或 fixture 的验证日期
- 异步任务策略和产物类型

## 五种模态

| 模态 | 最小运行时能力 |
|---|---|
| LLM | `chat`；流式另声明 `chat.stream` |
| Embedding | `embedding` |
| 图片 | `image.generation`、可选编辑/变体 |
| 音频 | `audio.speech` 或 `audio.transcription` |
| 视频 | 同时具备 `video.submit` 和 `video.query` |

视频 P0 只支持逐任务查询（`per_task`）。声明 `batch` 或 `dynamic` 而没有对应实现的适配器会被隔离，不能注册为可执行适配器。

## 注册规则

适配器路径来自源码注册表；同一 `id` 的重复注册会隔离，不能覆盖正在运行的实现。发布前生成 `adapter-index.json`，并校验 manifest 与源码 SHA256 一致。

## 参数与目录

模型目录只负责身份、厂商、模型族和参数建议。适配器 Schema、固定 fixture 或管理员确认才是执行契约。未知参数必须进入显式 `provider_options`，或在调用前返回结构化错误。

## 安全要求

- 站点地址经过 SSRF 校验。
- 出站请求禁止重定向并有超时。
- POST 只有在具备幂等语义时才允许重试；P0 不自动重试提交任务。
- API Key、Authorization、提示词和媒体 URL 不得进入日志、错误响应或测试快照。
- 不使用 `eval`、`new Function`、远程 import 或远程 JavaScript。

更多供应商证据见 `docs/MULTIMODAL-PROVIDER-EVIDENCE.md`。
