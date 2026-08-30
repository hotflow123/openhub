# 视频协议证据登记

本文件区分公共异步任务事实与供应商协议事实。未被文档、真实响应或固定 mock 证明的内容不得进入运行时合同。

## 证据来源

| 来源 | 用途 | 状态 |
|---|---|---|
| 当前 OpenHub 代码 | 记录现有任务、适配器和参数边界 | confirmed |
| 用户提供的 PixStag API 摘要 | 记录 content 数组、任务查询和结果字段差异 | candidate，待真实 fixture |
| OpenAI Videos API | 核对视频创建/查询协议 | provider_doc |
| Alibaba Model Studio 视频 API | 核对嵌套任务和异步状态 | provider_doc |
| Volcano Ark 内容生成 API | 核对 content 数组和任务结果 | provider_doc |
| AWS Bedrock Nova Reel | 核对非 URL 结果存储的异步语义 | provider_doc |
| Google Veo API | 核对长时间运行操作语义 | provider_doc |

## 协议登记

| provider | submit | query | task id | status | result URL | status |
|---|---|---|---|---|---|---|
| openai-like | POST /v1/{endpoint} | GET /v1/{endpoint}/{id} | id | status | result.video_url | fixture |
| dashscope-like | POST vendor submit path | GET vendor query path | output.task_id | output.task_status | output.video_url | fixture |
| content-array-like | POST provider submit path | GET provider query path | task_id | task.status | task.content[].url | fixture |
| MemeFast video | 未确认 | 未确认 | 未确认 | 未确认 | 未确认 | unverified |

## 实施规则

1. provider_doc、runtime 和 manual 证据可以进入候选或已确认契约。
2. catalog 只用于展示建议，不能单独激活执行参数。
3. fixture 只验证解析和状态机，不证明真实供应商已经支持该协议。
4. MemeFast 没有完整视频协议证据前，保持 video.submit 和 video.query 不支持。
