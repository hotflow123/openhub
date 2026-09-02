# 多模态供应商证据台账

本文件记录“已实现”与“可推测”之间的边界。没有文档、fixture 或运行时证据的能力，不进入已支持状态。

| 适配器 | 模态 | 身份 | 契约 | 任务策略 | 产物 | 状态 |
|---|---|---|---|---|---|---|
| `openai` | LLM、Embedding、图片、音频、视频 | 运行时/内置 manifest | 公共契约 + 适配器实现 | `per_task`（视频） | JSON、音频、图片、视频 | `supported_with_review` |
| `memefast` | LLM、Embedding、图片、音频；视频仅有元数据线索 | `/v1/models` 运行时发现（2026-09-01：465 个模型，40 个声明视频能力） | OpenAI 兼容能力；视频创建/查询协议仍未验证 | 同步；视频待验证 | JSON、音频、图片；视频未验证 | `supported_with_review` |
| `kling` | 视频 | 内置适配器 | 专用适配器实现 | `per_task` | 视频 | `supported_with_review` |
| `wan` | 视频 | 内置适配器 | 专用适配器实现 | `per_task` | 视频 | `supported_with_review` |
| `seedance` | 视频 | 内置适配器 | 专用适配器实现 | `per_task` | 视频 | `supported_with_review` |
| `grok` | 视频 | 内置适配器 | 专用适配器实现 | `per_task` | 视频 | `supported_with_review` |

## 证据口径

- `supported`：身份、契约、配置和运行时合规测试均通过。
- `supported_with_review`：公共链路可用，但仍需要供应商文档、真实联调或人工确认补齐证据。
- `adapter_required`：能识别供应商或模型，但当前没有可执行适配器。
- `unsupported`：当前代码没有可验证的能力证据。

## 当前限制

Open-Generative-AI is stored as an `open_generative_ai` parameter-template source. Its snapshot is advisory form metadata only; it never supplies an adapter URL, authentication, task lifecycle, or readiness evidence.

- 模型名可以高置信识别模型族，但不能凭名字生成供应商私有参数。
- Fal、models.dev 或其他目录数据不会覆盖已确认的供应商契约。
- MemeFast 当前已验证的是 LLM、Embedding、图片和音频；没有视频提交/查询协议证据，因此不标记为视频供应商。
- `new-api-plugins` 只作为设计参考，不作为 OpenHub 运行时依赖。

## 每个新适配器必须补充

协议来源、验证日期、模型绑定、Schema 状态、参数限制、任务状态映射、结果 URL 位置、用量字段、失败条件、fixture 和适配器版本/SHA256。
