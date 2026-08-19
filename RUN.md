# OpenHub 单命令启动（PowerShell）

按以下顺序在 PowerShell 中执行，每个命令单独运行。

## 1. 安装依赖

```powershell
cd F:\code\测试
pnpm install
```

**预期**：三个子包（catalog/server/web）都安装好，无错误。

如果遇到 `packageManager` 相关错误，确认 `package.json` 没有 `packageManager` 字段（已删除）。

## 2. 配置环境

```powershell
cd packages\server
Copy-Item .env.example .env
notepad .env
```

**必须修改**：`OPENHUB_MASTER_KEY` 设为 **至少 16 个字符**的随机字符串，例如：

```
OPENHUB_MASTER_KEY=please-change-me-32chars-min
```

保存后关闭。

## 3. 初始化数据库

```powershell
pnpm db:push
```

**预期**：

```
[✓] Pulling schema from schema files...
[✓] Changes applied
```

会在 `packages\server\data\openhub.db` 创建 SQLite 文件，包含 7 张表。

## 4. 启动后端

```powershell
pnpm dev
```

**预期日志**：

```
[openhub] schema verified
[openhub] listening on http://localhost:3000
```

**不要关闭这个终端**。

## 5. 启动前端（另一个 PowerShell）

```powershell
cd F:\code\测试
pnpm web:dev
```

**预期**：

```
  VITE v5.4.0  ready in xxx ms
  ➜  Local:   http://localhost:5173/
```

浏览器访问 http://localhost:5173

## 6. 验证（第三个 PowerShell）

### 6.1 健康检查

```powershell
curl http://localhost:3000/health
```

预期：`{"status":"ok"}`

### 6.2 创建站点

```powershell
$body = @{
    name = "Test"
    baseUrl = "https://api.openai.com"
    apiKey = "sk-your-real-key"
    adapterId = "openai"
} | ConvertTo-Json

$site = Invoke-RestMethod -Uri "http://localhost:3000/admin/sites" `
    -Method Post `
    -Headers @{ "Content-Type" = "application/json" } `
    -Body $body `
    -Credential (Get-Credential -Message "Enter admin credentials" -UserName "admin")

$SITE_ID = $site.data.id
Write-Host "Site ID: $SITE_ID"
```

`Get-Credential` 会弹窗输入密码（默认 `admin123`）。

### 6.3 查看模型（已自动发现）

```powershell
$cred = Get-Credential -UserName "admin"  # 输入 admin123
Invoke-RestMethod -Uri "http://localhost:3000/admin/models?site_id=$SITE_ID" -Credential $cred
```

### 6.4 创建虚拟 Key

```powershell
$cred = Get-Credential -UserName "admin"
$key = Invoke-RestMethod -Uri "http://localhost:3000/admin/keys" `
    -Method Post `
    -Headers @{ "Content-Type" = "application/json" } `
    -Body '{"name":"dev"}' `
    -Credential $cred

$HUB_KEY = $key.data.key
Write-Host "Hub Key: $HUB_KEY"
Write-Host "保存此 key！窗口关闭后无法再次查看"
```

### 6.5 创建变体

```powershell
$cred = Get-Credential -UserName "admin"
$models = Invoke-RestMethod -Uri "http://localhost:3000/admin/models?site_id=$SITE_ID" -Credential $cred
$MODEL_ID = $models.data[0].id

Invoke-RestMethod -Uri "http://localhost:3000/admin/variants" `
    -Method Post `
    -Headers @{ "Content-Type" = "application/json" } `
    -Body (@{ name = "gpt-4o"; modelId = $MODEL_ID } | ConvertTo-Json) `
    -Credential $cred
```

### 6.6 发起 chat 请求

```powershell
$body = @{
    model = "gpt-4o"
    messages = @(
        @{ role = "user"; content = "1+1=?" }
    )
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Uri "http://localhost:3000/v1/chat/completions" `
    -Method Post `
    -Headers @{
        "Content-Type" = "application/json"
        "Authorization" = "Bearer $HUB_KEY"
    } `
    -Body $body
```

预期：返回 OpenAI 兼容的 chat completion 响应。

### 6.7 触发目录同步

```powershell
$cred = Get-Credential -UserName "admin"
Invoke-RestMethod -Uri "http://localhost:3000/admin/catalog/sync" `
    -Method Post `
    -Credential $cred
```

预期：

```json
{
  "data": {
    "status": "success",
    "total": 612,
    "added": 612,
    "updated": 0,
    "removed": 0,
    "durationMs": 4521
  }
}
```

---

## 常见错误快速排查

| 错误 | 修复 |
|---|---|
| `OPENHUB_MASTER_KEY is not set` | 编辑 `packages\server\.env` |
| `Missing tables: sites, ...` | `pnpm db:push` |
| `Cannot find module '@openhub/catalog'` | 删除 `node_modules`，重新 `pnpm install` |
| `MODULE_NOT_FOUND: better-sqlite3` | `pnpm rebuild better-sqlite3` |
| chat 请求 401 | 确认 Bearer token 是创建 key 时返回的明文 |
| chat 请求 404 variant_not_found | 确认请求 body 的 `model` 是 variant name（不是站点模型名） |
| catalog sync 失败 | 检查网络能否访问 `https://models.dev/api/v0/models.json` |

---

## 完成 Phase 1+2 的标志

- ✅ 后端启动无错误
- ✅ 前端访问 http://localhost:5173 看到管理后台
- ✅ 创建站点、Key、变体各 1 个
- ✅ chat 请求成功返回上游响应
- ✅ catalog sync 写入 600+ 条目录数据

---

## 7. Mock 端到端（无需真实上游 Key）

在没有真实 New API / OpenAI Key 时，可以用 `mock-echo.cjs` 模拟一个最小 OpenAI 兼容服务，验证整条链路。

### 7.1 启动 mock

```powershell
node F:\code\测试\mock-echo.cjs 9999
```

预期：

```
mock-echo listening on http://0.0.0.0:9999
```

### 7.2 创建站点 + 发现模型

```powershell
curl -s -X POST http://localhost:3000/admin/sites `
  -u admin:admin123 `
  -H "Content-Type: application/json" `
  -d '{"name":"mock-local","baseUrl":"http://localhost:9999","apiKey":"mock-key","adapterId":"openai"}'
```

输出包含 `id`，记为 `$SITE_ID`。模型会在创建站点时自动发现（5 个 mock 模型）。

### 7.3 创建变体

```powershell
# chat 变体
curl -s -X POST http://localhost:3000/admin/variants -u admin:admin123 `
  -H "Content-Type: application/json" `
  -d "{\"name\":\"mock-gpt4o-mini\",\"modelId\":\"${SITE_ID}__gpt-4o-mini\"}"
```

### 7.4 创建虚拟 Key

```powershell
curl -s -X POST http://localhost:3000/admin/keys -u admin:admin123 `
  -H "Content-Type: application/json" `
  -d '{"name":"e2e"}'
```

输出里 `data.key` 是明文 token，记为 `$HUB_KEY`。

### 7.5 发起 chat

```powershell
curl -s -X POST http://localhost:3000/v1/chat/completions `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer $HUB_KEY" `
  -d '{"model":"mock-gpt4o-mini","messages":[{"role":"user","content":"hello"}]}'
```

预期：`HTTP 200` + `mock-reply(gpt-4o-mini):hello`。同样支持 `image/audio/embeddings`：

```powershell
# 图片
curl -s -X POST http://localhost:3000/v1/images/generations `
  -H "Content-Type: application/json" -H "Authorization: Bearer $HUB_KEY" `
  -d "{\"model\":\"mock-dalle\",\"prompt\":\"cat\"}"

# 音频
curl -s -o out.mp3 -X POST http://localhost:3000/v1/audio/speech `
  -H "Content-Type: application/json" -H "Authorization: Bearer $HUB_KEY" `
  -d "{\"model\":\"mock-tts\",\"input\":\"hi\",\"voice\":\"alloy\"}"

# 嵌入
curl -s -X POST http://localhost:3000/v1/embeddings `
  -H "Content-Type: application/json" -H "Authorization: Bearer $HUB_KEY" `
  -d "{\"model\":\"mock-embed\",\"input\":\"hi\"}"
```

### 7.6 列出对外模型

```powershell
curl -s http://localhost:3000/v1/models
```

应返回所有 variant name（`mock-gpt4o-mini`、`mock-dalle` 等）。

---

## 8. 本次会话期间补充的功能与修复

| 行为 | 实现位置 | 说明 |
|---|---|---|
| `initApp` 启动时自动跑一次目录同步 | `packages/server/src/db/init.ts` | 同步失败不阻塞；离线环境在日志提示 `catalog bootstrap skipped` |
| `POST /admin/catalog/sync` 5s 超时 + 失败返回 200 | `packages/catalog/src/sync/perform.ts` + `packages/server/src/routes/admin/catalog.ts` | 同步状态存到 `data.status`，避免 30s 阻塞 |
| `POST /admin/variants` 重复 name 触发 409 | `packages/server/src/routes/admin/variants.ts` | 带 `existingId`，并发写入也兜底 |
| `mock-echo.cjs` 最小 OpenAI 兼容 mock | `F:\code\测试\mock-echo.cjs` | `/v1/models` `/v1/chat/completions` `/v1/embeddings` `/v1/images/generations` `/v1/audio/speech` `/v1/videos` 已实现 |
| `openaiAdapter` 启用视频异步 | `packages/server/src/engine/adapters/openai.ts` | 通过 `adapterConfig.video.endpoint` 启用，提交 / 轮询走 `/v1/{endpoint}` 与 `/v1/{endpoint}/:id` |
| 任务 worker 状态映射修正 | `packages/server/src/engine/tasks/worker.ts` | 从 `result.raw.status` 取出真实状态字段，而不是把 raw 对象直接喂给 mapGenericVideoStatus |
| `scripts/e2e.sh` 端到端验证 | `F:\code\测试\scripts\e2e.sh` | 7 个用例：v1/models/chat/image/audio/embed/video async/param mapping/uniq/同步失败 |

---

## 9. 一次跑完整套验证

```powershell
# Terminal 1：启动 mock
node F:\code\测试\mock-echo.cjs 9999

# Terminal 2：启动后端
cd F:\code\测试\packages\server
pnpm dev
```

```powershell
# Terminal 3：建 mock 站点 + 几个 variant（一次性）
$site = Invoke-RestMethod -Method Post -Uri "http://localhost:3000/admin/sites" -Credential (Get-Credential -UserName admin) -ContentType "application/json" -Body '{"name":"mock","baseUrl":"http://localhost:9999","apiKey":"mock","adapterId":"openai"}'
$key = Invoke-RestMethod -Method Post -Uri "http://localhost:3000/admin/keys" -Credential (Get-Credential -UserName admin) -ContentType "application/json" -Body '{"name":"e2e"}'
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/admin/sites/$($site.data.id)/discover" -Credential (Get-Credential -UserName admin)

# 创建 4 个 variant（chat / image / audio / video）和 1 个带参数映射的 variant
foreach ($pair in @(
  @{n="mock-gpt4o-mini";m="gpt-4o-mini";cfg=$null},
  @{n="mock-dalle";m="dall-e-3";cfg=$null},
  @{n="mock-tts";m="tts-1";cfg=$null},
  @{n="mock-embed";m="text-embedding-3-small";cfg=$null},
  @{n="mock-sora";m="sora-mock";cfg='{"video":{"endpoint":"videos"}}'},
  @{n="mock-param-mapped";m="gpt-4o-mini";cfg=$null}
)) {
  $body = @{ name = $pair.n; modelId = "$($site.data.id)__$($pair.m)" }
  if ($pair.cfg) { $body.adapterConfig = ($pair.cfg | ConvertFrom-Json) }
  if ($pair.n -eq "mock-param-mapped") {
    $body.paramMapping = @{
      param_overrides = @{ temperature = 0.1; user = "mapped-by-variant" }
      param_blocked = @("top_p")
      field_mapping = @{}
      adapter = @{ fixedParams = @{}; param_defaults = @{} }
    }
  }
  Invoke-RestMethod -Method Post -Uri "http://localhost:3000/admin/variants" -Credential (Get-Credential -UserName admin) -ContentType "application/json" -Body ($body | ConvertTo-Json -Depth 6)
}

# 设置变量并跑 e2e
$env:HUB_KEY = $key.data.key
bash F:\code\测试\scripts\e2e.sh
```

**预期**：

```
== 1. /v1/models ==                              PASS
== 2. chat ==                                    PASS
== 3. image / audio / embedding ==               PASS x3
== 4. video async submit + poll ==               PASS
== 5. 参数映射 ==                                 PASS
== 6. 重复 variant name → 409 ==                  PASS
== 7. catalog sync 友好失败 ==                    PASS
所有验证通过！
```

视频异步一项最长需要 12-15s（worker 轮询周期 10s + mock 模拟 2s 完成）。
