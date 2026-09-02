# OpenHub 多模态接入

OpenHub 对外提供一个稳定的 HTTP API；调用方只保存 OpenHub Key，不接触供应商 Key，也不需要知道供应商的请求路径。

## 端点

| 模态 | 方法 | 端点 | 结果 |
|---|---|---|---|
| LLM | `POST` | `/v1/chat/completions` | JSON；`stream=true` 返回 SSE |
| Embedding | `POST` | `/v1/embeddings` | JSON 向量 |
| 图片 | `POST` | `/v1/images/generations` | JSON 图片 URL 或 Base64 |
| 音频生成 | `POST` | `/v1/audio/speech` | 音频二进制 |
| 音频转写 | `POST` | `/v1/audio/transcriptions` | `multipart/form-data` JSON |
| 视频创建 | `POST` | `/v1/video/generations` | 任务 ID |
| 视频查询 | `GET` | `/v1/video/tasks/:id` | 任务状态和结果 |

所有端点使用：

```http
Authorization: Bearer <openhub-key>
```

请求中的 `model` 是 OpenHub 变体名，不一定是供应商原始模型名。供应商私有字段放在 `provider_options`；未被当前模型契约确认的字段会在调用前被拒绝，不会静默丢弃。

## 视频流程

1. 创建视频任务，保存返回的 `id`。
2. 查询 `/v1/video/tasks/:id`，直到状态为 `completed`、`failed` 或 `timeout`。
3. 成功时读取 `result`；结果 URL 可能有有效期。
4. 需要服务端通知时传入公共 HTTPS `callback_url`；该回调是 OpenHub 的任务通知，不是供应商回调地址。

## JavaScript 客户端

仓库内的 `@openhub/client` 只封装上述 HTTP API：

```ts
import { OpenHubClient } from "@openhub/client";

const hub = new OpenHubClient({
  baseUrl: "https://your-openhub.example",
  apiKey: process.env.OPENHUB_KEY!,
});

const response = await hub.chat({
  model: "my-chat-variant",
  messages: [{ role: "user", content: "你好" }],
});
```

浏览器直连只适合开发或受控环境。生产网站应由自己的后端调用 OpenHub，避免把 OpenHub Key 暴露给浏览器用户。

## 边界

- OpenHub 统一任务生命周期、鉴权、错误和结果结构；不承诺把所有供应商私有参数强行统一。
- 模型名称可以帮助识别身份和模态，但不能单独证明参数契约。
- 没有适配器、Schema 或固定 fixture 证据的能力显示为待复核或不支持，不能调用。
- 新增普通协议供应商不应要求上层应用增加供应商分支；特殊协议需要受审查的 SDK 适配器。
