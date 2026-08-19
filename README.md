# OpenHub 跑通手册（本地终端执行）

> 本文档配合 `F:\code\测试\DESIGN.md` 第 17 章执行计划使用。
> 由于沙箱无法执行命令，下面所有命令请在本地 PowerShell / 终端运行。

---

## 0. 前置要求

- Node.js >= 22
- pnpm >= 9（如未安装：`npm i -g pnpm`）
- 一个可访问的 New API 站点（用于联调）

---

## 1. 安装依赖

```powershell
cd F:\code\测试
pnpm install
```

预期：`packages/{server,catalog,web}` 三个子包都安装好，无 peer dep 错误。

---

## 2. 初始化数据库

```powershell
cd packages\server
pnpm db:push
```

预期：在 `packages\server\data\openhub.db` 生成 SQLite 文件，包含
`sites / models / keys / variants / model_catalog / model_catalog_alias / catalog_sync_runs` 7 张表。

如需交互式查看数据：

```powershell
pnpm db:studio
```

---

## 3. 配置环境变量

复制示例文件并按需修改：

```powershell
cd packages\server
copy .env.example .env
notepad .env
```

至少确认 `OPENHUB_MASTER_KEY` 已设置为长度 >= 16 的随机字符串。
管理后台账号默认 `admin / admin123`，生产环境请改。

---

## 4. 启动后端

```powershell
cd packages\server
pnpm dev
```

预期日志：

```
[openhub] listening on http://localhost:3000
```

另开一个终端，启动前端：

```powershell
cd F:\code\测试
pnpm web:dev
```

预期：Vite 启动，访问 http://localhost:5173

---

## 5. Phase 1 全链路验证（按 DESIGN 第 17 章）

### 5.1 健康检查

```powershell
curl http://localhost:3000/health
```

预期：`{"status":"ok"}`

### 5.2 创建站点

```powershell
$SITE = curl -s -X POST http://localhost:3000/admin/sites `
  -H "Content-Type: application/json" `
  -u "admin:admin123" `
  -d '{\"name\":\"Test\",\"baseUrl\":\"https://api.openai.com\",\"apiKey\":\"sk-xxx\",\"adapterId\":\"openai\"}'
$SITE_ID = ($SITE | ConvertFrom-Json).data.id
```

预期返回 `{"data":{"id":"...","name":"Test","status":"active"}}`，后台日志显示已自动发现模型并尝试匹配目录。

### 5.3 触发模型发现

```powershell
curl -X POST "http://localhost:3000/admin/sites/$SITE_ID/discover" -u "admin:admin123"
```

### 5.4 创建虚拟 Key

```powershell
$KEY = curl -s -X POST http://localhost:3000/admin/keys `
  -H "Content-Type: application/json" `
  -u "admin:admin123" `
  -d '{\"name\":\"dev\"}'
$HUB_KEY = ($KEY | ConvertFrom-Json).data.key
```

**注意**：明文 key 仅返回一次，保存到 `$HUB_KEY` 后不要关闭终端。

### 5.5 创建变体

先获取模型 id：

```powershell
$MODELS = curl -s "http://localhost:3000/admin/models?site_id=$SITE_ID" -u "admin:admin123"
$MODEL_ID = ($MODELS | ConvertFrom-Json).data[0].id
```

创建变体：

```powershell
curl -X POST http://localhost:3000/admin/variants `
  -H "Content-Type: application/json" `
  -u "admin:admin123" `
  -d "{\"name\":\"gpt-4o\",\"modelId\":\"$MODEL_ID\"}"
```

### 5.6 发起 chat 请求

```powershell
curl -X POST http://localhost:3000/v1/chat/completions `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer $HUB_KEY" `
  -d '{\"model\":\"gpt-4o\",\"messages\":[{\"role\":\"user\",\"content\":\"1+1=?\"}]}'
```

预期：返回上游模型的 chat completion 响应。

### 5.7 列出模型

```powershell
curl http://localhost:3000/v1/models -H "Authorization: Bearer $HUB_KEY"
```

---

## 6. Phase 2 目录同步验证

### 6.1 触发目录同步

```powershell
curl -X POST http://localhost:3000/admin/catalog/sync -u "admin:admin123"
```

预期（首次同步约 5-10 秒）：

```json
{ "data": { "status": "success", "total": 612, "added": 612, "updated": 0, "removed": 0, "durationMs": 4521 } }
```

### 6.2 查看同步日志

```powershell
curl http://localhost:3000/admin/catalog/runs -u "admin:admin123"
```

### 6.3 查询目录条目

```powershell
curl "http://localhost:3000/admin/catalog?q=gpt-4o" -u "admin:admin123"
```

### 6.4 强制重新匹配

```powershell
curl -X POST http://localhost:3000/admin/catalog/rematch -u "admin:admin123"
```

---

## 7. 常见问题

### 7.1 安装/启动阶段

| 现象 | 原因 | 修复 |
|---|---|---|
| `OPENHUB_MASTER_KEY is not set` | 没设环境变量 | 编辑 `packages\server\.env` |
| `[openhub] schema init failed: Missing tables` | 没跑 `pnpm db:push` | `cd packages\server && pnpm db:push` |
| `pnpm install` 报 peer dep 错误 | Node 版本过低 | 升级到 Node 22+ |
| `Cannot find module '@openhub/catalog'` | workspace 链接未建立 | 删除 `node_modules` 后重新 `pnpm install` |
| `MODULE_NOT_FOUND: better-sqlite3` | native 模块未编译 | `pnpm rebuild better-sqlite3` |
| 端口 3000 占用 | 已有进程占用 | 改 `PORT` 环境变量 |

### 7.2 运行时阶段

| 现象 | 原因 | 修复 |
|---|---|---|
| `/admin/*` 返回 401 | 没传 Basic Auth | curl 加 `-u "admin:admin123"`，UI 走自动 Basic 弹窗 |
| `/v1/*` 返回 401 missing_auth | 缺 `Authorization: Bearer <hub-key>` | 用创建 Key 时返回的明文 |
| `/v1/chat/completions` 返回 404 variant_not_found | 用了模型名（如 `gpt-4o`）而非变体名 | 在管理后台确认 variant name |
| chat 返回 502 upstream_error | 上游 New API 不可达 | 检查站点的 baseUrl + Key，用 `/admin/sites/:id/health` 测试 |
| `Catalog schema validation failed` | models.dev schema 变更 | 等 OpenHub 升级到上游 |
| `Discover models failed: HTTP 401` | 上游站点 API Key 无效 | 在 UI 重新编辑站点更新 Key |
| `fetch failed` on catalog sync | 网络无法访问 models.dev | 配 `MODELS_DEV_URL` 或跳过 Phase 2 |
| 自动匹配率低 | 站点模型名不规范 | 在 UI 用 `/admin/catalog?q=...` 找目录 ID，然后手动建变体 |

### 7.3 前端开发

| 现象 | 修复 |
|---|---|
| 端口 5173 占用 | 改 `packages\web\vite.config.ts` 的 `server.port` |
| 前端请求后端 404 | 确认 vite proxy 配置（已配置 `/v1` `/admin` → `localhost:3000`） |
| TS 类型错 | `pnpm typecheck` 查看完整错误 |

---

## 8. Docker 一键启动（开发联调用）

```powershell
cd F:\code\测试
copy .env.docker .env       # Windows
docker compose up --build
```

预期：

- 服务监听 `http://localhost:3000`
- 数据卷 `openhub-data` 持久化 SQLite 文件
- 默认管理账号 `admin / admin123`（**生产前必须改**）

---

## 8. 目录结构

```
F:\code\测试\
├── DESIGN.md                      # 设计文档（只读）
├── README.md                      # 本文件
├── package.json                   # monorepo 根
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .gitignore
└── packages/
    ├── catalog/                   # 复用上游 + 自研 sync/matcher（独立 workspace 包）
    │   ├── package.json
    │   ├── tsconfig.json
    │   └── src/
    │       ├── index.ts
    │       ├── upstream/
    │       │   ├── index.ts
    │       │   ├── schema.ts      # 直接复用上游 Zod 字段定义（MIT）
    │       │   ├── family.ts      # ModelFamilyValues + inferKimiFamily
    │       │   ├── stable.ts      # 复用上游 stable 函数
    │       │   └── omit.ts        # 复用上游 applyOmit
    │       ├── sync/
    │       │   ├── index.ts
    │       │   ├── perform.ts     # 自研：performSync（依赖注入式）
    │       │   ├── catalog-to-fields.ts
    │       │   └── types.ts
    │       └── matcher/
    │           ├── index.ts
    │           └── match-model.ts # 自研：四步匹配算法
    ├── server/                    # Hono + Drizzle + SQLite
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── drizzle.config.ts
    │   ├── .env / .env.example
    │   └── src/
    │       ├── index.ts
    │       ├── db/
    │       │   ├── index.ts       # drizzle 实例
    │       │   └── schema/
    │       │       ├── index.ts
    │       │       ├── sites.ts
    │       │       ├── models.ts
    │       │       ├── keys.ts
    │       │       ├── variants.ts
    │       │       └── catalog.ts
    │       ├── lib/
    │       │   ├── crypto.ts      # AES-256-GCM
    │       │   └── token.ts       # Key 生成 + hash
    │       ├── middleware/
    │       │   ├── auth.ts        # Hub 虚拟 Key
    │       │   └── admin-auth.ts  # 管理后台 Basic Auth
    │       ├── engine/
    │       │   ├── index.ts
    │       │   ├── adapter.ts
    │       │   ├── adapters/
    │       │   │   └── openai.ts
    │       │   ├── discover.ts
    │       │   └── catalog/
    │       │       ├── db-adapter.ts
    │       │       └── match-after-discover.ts
    │       └── routes/
    │           ├── api.ts
    │           ├── admin.ts
    │           ├── admin/
    │           │   ├── sites.ts
    │           │   ├── keys.ts
    │           │   ├── variants.ts
    │           │   ├── models.ts
    │           │   └── catalog.ts
    │           ├── v1/
    │           │   ├── models.ts
    │           │   ├── chat.ts
    │           │   └── embeddings.ts
    │           └── router.ts
    └── web/                       # React + Vite 管理后台
        ├── package.json
        ├── tsconfig.json
        ├── vite.config.ts
        ├── index.html
        ├── .env
        └── src/
            ├── main.tsx
            ├── App.tsx
            ├── index.css
            ├── lib/
            │   └── api.ts
            └── pages/
                ├── Sites.tsx
                ├── Models.tsx
                ├── Keys.tsx
                ├── Variants.tsx
                └── Catalog.tsx
```

---

## 9. Phase 2 之后的下一步

Phase 2 完成后，按 DESIGN 第 17 章 Phase 3 进入：
- 图片 / 音频 / 视频适配器
- 异步任务管理（轮询 worker + webhook）
- 变体组 / 多站点降级
- 参数映射执行引擎
- 模型引导配置向导（LLM 推断）

每个新功能都应先在 DESIGN 文档中确认数据模型，再写代码。