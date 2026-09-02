# OpenHub 运维基线

本文档只描述当前仓库能保证的运维行为，不替代具体云厂商的部署配置。

## 启动配置

生产环境至少设置：

- `NODE_ENV=production`
- `OPENHUB_MASTER_KEY`：长度至少 16 的随机值，并在所有实例保持一致
- `OPENHUB_DB_URL`：持久化 SQLite 文件路径
- `PORT`：服务端监听端口
- `MODELS_DEV_URL`：目录数据源地址
- `CATALOG_SYNC_INTERVAL_MS`：目录同步周期，最小 `60000`
- `CATALOG_SYNC_TIMEOUT_MS`：目录请求超时，最小 `1000`

不要把 `.env`、数据库文件或供应商 Key 提交到 Git。

## 健康检查

`GET /health` 是进程存活检查，预期返回 HTTP `200` 和 `{"status":"ok"}`。监控系统应在连续失败后告警，而不是把一次网络抖动直接判定为数据损坏。

目录同步失败会写入同步运行记录，并输出包含 `[cron] catalog sync failed` 或 `[cron] catalog sync error` 的日志；生产日志系统应对这两个模式告警。

适配器注册失败会进入 `invalid`、`extension_required` 或 `quarantined` 状态。只有全部适配器都不可执行时才应阻止服务提供调用。

## 数据库备份

使用 SQLite 原生 backup API 创建一致性副本，即使数据库启用了 WAL 也不要直接复制主文件：

```powershell
cd packages/server
pnpm db:backup
```

默认备份写入 `packages/server/data/backups/`。也可以指定输出位置：

```powershell
pnpm db:backup --output=./data/backups/openhub-manual.db
```

部署环境应由外部任务保留至少一个日备份和一个周备份，并定期在隔离环境恢复验证；仓库脚本不负责云端保留策略。

## 发布验收

```powershell
pnpm typecheck
pnpm test
pnpm --filter @openhub/server test:adapters
pnpm --filter @openhub/server adapter-index:check
pnpm --filter @openhub/web build
Invoke-WebRequest http://localhost:3000/health
```

真实供应商调用必须另有协议文档、fixture 或明确的非生产凭据；目录命中和本地 fixture 不能替代联调证据。
