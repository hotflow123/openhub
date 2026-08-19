# OpenHub models.dev 集成补全执行计划

**生成时间**: 2026-08-17 04:15 AM (UTC+8)  
**基于**: DESIGN.md (4084 行) + COMPLETION_STATUS.md + models.dev 仓库调研  
**目标**: 完善 models.dev 数据源集成，提升目录覆盖率和匹配准确性

---

## 📋 执行背景

### 当前状态

根据 `COMPLETION_STATUS.md`，OpenHub 项目已 **100% 完成** DESIGN.md 中定义的所有功能：

- ✅ Phase 0-3 全部完成
- ✅ 57/57 E2E 测试通过
- ✅ models.dev 目录同步机制已实现
- ✅ 四步匹配器已实现
- ✅ Wizard 配置向导已完整

### models.dev 仓库现状

**仓库地址**: https://github.com/anomalyco/models.dev  
**许可证**: MIT License

**重要限制**: 
- ⚠️ **Windows 克隆失败**: 仓库中包含大量文件名含 `:` 的 TOML 文件（如 `amazon.nova-2-lite-v1:0.toml`），NTFS 不支持
- ✅ **解决方案**: 必须通过 JSON API (`https://models.dev/api/v0/models.json`) 消费数据，不能直接克隆源码

**已实现的集成**:
- ✅ JSON API 同步 (`packages/catalog/src/sync/perform.ts`)
- ✅ 内置快照 (`packages/server/src/engine/capability/catalog-snapshot.json`)
- ✅ Zod schema 校验 (`packages/catalog/src/upstream/schema.ts`)

---

## 🎯 补全目标

虽然项目已完成，但可以进一步优化 models.dev 集成：

### 1. 扩充 Family 枚举覆盖率 ✅ (已完成)
**现状**: 项目已有完整的 family 关键词匹配  
**优化**: 可参考 models.dev 的 `family.ts`（200+ 枚举值）扩充

### 2. 增强目录快照数据 ⚡ (建议优化)
**现状**: 内置快照 `catalog-snapshot.json` 包含基础模型  
**优化**: 定期更新快照以包含最新模型

### 3. 复用上游工具函数 📦 (可选增强)
**现状**: 项目已自行实现 schema 和 sync 逻辑  
**优化**: 可复用 models.dev 的以下 MIT 代码：
- `normalize()` 函数 (字符串归一化)
- `stable()` 函数 (语义 hash 计算)
- `ModelFamilyValues` 枚举

### 4. 建立定时同步机制 🔄 (生产环境建议)
**现状**: 手动触发同步 (`POST /admin/catalog/sync`)  
**优化**: 添加自动定时同步（每日凌晨 3:00）

---

## 🚀 详细执行计划

由于项目已完成，以下计划为**可选优化项**，按优先级排序。

---

### Task 1: 更新内置目录快照 (优先级: 高)

**目标**: 用最新的 models.dev 数据更新内置快照

#### 步骤

**Step 1.1**: 下载最新 models.dev 数据

```bash
# 已完成：models.dev-snapshot.json 已下载到根目录
# 验证：
Get-Content models.dev-snapshot.json | ConvertFrom-Json | Select-Object -ExpandProperty data | Measure-Object
```

**Step 1.2**: 转换为项目快照格式

```bash
cd packages/server/src/engine/capability
# 备份旧快照
Copy-Item catalog-snapshot.json catalog-snapshot.backup.json
```

创建转换脚本 `tools/sync-snapshot-from-models-dev.ts`:

```typescript
/**
 * 从 models.dev JSON 生成项目内置快照
 * 用法: bun run tools/sync-snapshot-from-models-dev.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface ModelsDevItem {
  id: string;
  name: string;
  lab?: string;
  lab_name?: string;
  family?: string;
  modalities?: { input: string[]; output: string[] };
  limit?: { context?: number; input?: number; output?: number };
  reasoning?: boolean;
  tool_call?: boolean;
  structured_output?: boolean;
  temperature?: boolean;
  attachment?: boolean;
}

interface ModelsDevResponse {
  data: ModelsDevItem[];
}

interface SnapshotModel {
  id: string;
  name: string;
  lab: string;
  lab_name: string;
  family?: string | null;
  modalities?: { input: string[]; output: string[] };
  limit?: { context?: number; input?: number; output?: number };
  reasoning?: boolean;
  tool_call?: boolean;
  structured_output?: boolean;
}

interface Snapshot {
  version: string;
  source: string;
  models: SnapshotModel[];
}

const sourceFile = join(process.cwd(), "models.dev-snapshot.json");
const targetFile = join(
  process.cwd(),
  "packages/server/src/engine/capability/catalog-snapshot.json"
);

const raw = readFileSync(sourceFile, "utf-8");
const parsed: ModelsDevResponse = JSON.parse(raw);

const snapshot: Snapshot = {
  version: new Date().toISOString().split("T")[0],
  source: "models.dev",
  models: parsed.data.map((item) => ({
    id: item.id,
    name: item.name,
    lab: item.lab ?? "unknown",
    lab_name: item.lab_name ?? item.lab ?? "Unknown",
    family: item.family ?? null,
    modalities: item.modalities,
    limit: item.limit,
    reasoning: item.reasoning ?? false,
    tool_call: item.tool_call ?? false,
    structured_output: item.structured_output ?? false,
  })),
};

writeFileSync(targetFile, JSON.stringify(snapshot, null, 2));
console.log(`✅ Snapshot updated: ${snapshot.models.length} models`);
```

**Step 1.3**: 执行转换并验证

```bash
bun run tools/sync-snapshot-from-models-dev.ts

# 验证结果
Get-Content packages/server/src/engine/capability/catalog-snapshot.json | ConvertFrom-Json | Select-Object -ExpandProperty models | Measure-Object
```

**验收标准**:
- ✅ 快照文件更新成功
- ✅ 模型数量 > 500（models.dev 当前数据）
- ✅ `pnpm dev` 启动时日志显示 "catalog snapshot loaded: X new"

---

### Task 2: 复用 models.dev 工具函数 (优先级: 中)

**目标**: 从 models.dev 仓库复用 MIT 许可的工具代码

#### 步骤

**Step 2.1**: 获取源码（绕过 Windows 限制）

由于无法直接克隆，使用 GitHub API 获取单个文件：

```bash
# 创建目录
New-Item -ItemType Directory -Force -Path packages/catalog/src/upstream

# 下载 family.ts
Invoke-WebRequest `
  -Uri "https://raw.githubusercontent.com/anomalyco/models.dev/main/packages/core/src/family.ts" `
  -OutFile "packages/catalog/src/upstream/family.ts"

# 下载 normalize.ts
Invoke-WebRequest `
  -Uri "https://raw.githubusercontent.com/anomalyco/models.dev/main/packages/core/src/util/normalize.ts" `
  -OutFile "packages/catalog/src/upstream/normalize.ts"

# 下载 stable.ts
Invoke-WebRequest `
  -Uri "https://raw.githubusercontent.com/anomalyco/models.dev/main/packages/core/src/util/stable.ts" `
  -OutFile "packages/catalog/src/upstream/stable.ts"
```

**Step 2.2**: 添加许可证声明

在每个文件顶部添加：

```typescript
/**
 * Adapted from anomalyco/models.dev
 * Original: https://github.com/anomalyco/models.dev/blob/main/packages/core/src/[filename]
 * License: MIT
 * 
 * Copyright (c) 2024 Anomaly Labs, Inc.
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files...
 */
```

**Step 2.3**: 集成到现有代码

更新 `packages/catalog/src/sync/perform.ts`:

```typescript
// 导入复用的 stable 函数
import { stable } from "../upstream/stable.js";

// 现有代码已在使用 stable()，确认导入路径正确即可
```

更新 `packages/catalog/src/matcher/normalize.ts`:

```typescript
// 复用 models.dev 的 normalize 实现
import { normalize as upstreamNormalize } from "../upstream/normalize.js";

export function normalize(s: string): string {
  return upstreamNormalize(s);
}
```

**验收标准**:
- ✅ 文件下载成功
- ✅ 许可证声明完整
- ✅ 类型检查通过 (`pnpm typecheck`)
- ✅ E2E 测试仍然通过

---

### Task 3: 添加定时同步机制 (优先级: 中)

**目标**: 生产环境自动同步 models.dev 目录

#### 步骤

**Step 3.1**: 创建定时任务模块

`packages/server/src/jobs/catalog-sync-cron.ts`:

```typescript
/**
 * 定时目录同步任务
 * 
 * 默认：每日凌晨 3:00 UTC+8
 * 环境变量控制：CATALOG_SYNC_CRON (cron 表达式)
 */
import { CronJob } from "cron";
import { performSync } from "@openhub/catalog/sync";
import { syncDb } from "../engine/catalog/db-adapter.js";
import { matchModelsForSite } from "../engine/catalog/match-after-discover.js";
import { db } from "../db/index.js";
import { sites } from "../db/schema/index.js";

const CRON_SCHEDULE = process.env.CATALOG_SYNC_CRON ?? "0 3 * * *"; // 每日 03:00

export function startCatalogSyncCron() {
  const job = new CronJob(
    CRON_SCHEDULE,
    async () => {
      console.log("[cron] Starting catalog sync...");
      const result = await performSync(syncDb);
      
      if (result.status === "success") {
        console.log(`[cron] Catalog synced: +${result.added} ~${result.updated}`);
        
        // 重新匹配所有站点
        const allSites = await db.select({ id: sites.id }).from(sites);
        for (const s of allSites) {
          await matchModelsForSite(s.id).catch((e) =>
            console.error(`[cron] re-match site ${s.id} failed:`, e)
          );
        }
      } else {
        console.error(`[cron] Catalog sync failed: ${result.errorMessage}`);
      }
    },
    null,
    true, // start immediately
    "Asia/Shanghai"
  );

  console.log(`[cron] Catalog sync scheduled: ${CRON_SCHEDULE}`);
  return job;
}
```

**Step 3.2**: 集成到主服务

更新 `packages/server/src/index.ts`:

```typescript
import { startCatalogSyncCron } from "./jobs/catalog-sync-cron.js";

// 在 serve() 之后启动定时任务
if (process.env.NODE_ENV === "production") {
  startCatalogSyncCron();
}
```

**Step 3.3**: 添加依赖

```bash
cd packages/server
pnpm add cron
pnpm add -D @types/cron
```

**验收标准**:
- ✅ 生产环境启动时日志显示 "Catalog sync scheduled"
- ✅ 手动触发测试：到达指定时间后自动执行同步
- ✅ 同步失败时有错误日志

---

### Task 4: 创建 models.dev 数据分析工具 (优先级: 低)

**目标**: 帮助管理员了解目录覆盖情况

#### 步骤

**Step 4.1**: 创建分析脚本

`tools/analyze-catalog-coverage.ts`:

```typescript
/**
 * 分析目录覆盖率
 * 用法: bun run tools/analyze-catalog-coverage.ts
 */
import { db } from "../packages/server/src/db/index.js";
import { models, modelCatalog } from "../packages/server/src/db/schema/index.js";
import { isNull, isNotNull, sql } from "drizzle-orm";

async function analyze() {
  // 统计总模型数
  const totalModels = await db
    .select({ count: sql<number>`count(*)` })
    .from(models);

  // 已匹配目录的模型数
  const matchedModels = await db
    .select({ count: sql<number>`count(*)` })
    .from(models)
    .where(isNotNull(models.catalogModelId));

  // 目录总条目数
  const totalCatalog = await db
    .select({ count: sql<number>`count(*)` })
    .from(modelCatalog);

  // 按匹配来源分组统计
  const bySource = await db
    .select({
      source: models.catalogMatchSource,
      count: sql<number>`count(*)`,
    })
    .from(models)
    .where(isNotNull(models.catalogMatchSource))
    .groupBy(models.catalogMatchSource);

  // 按 family 分组统计（未匹配的）
  const unmatchedByFamily = await db
    .select({
      family: models.family,
      count: sql<number>`count(*)`,
    })
    .from(models)
    .where(isNull(models.catalogModelId))
    .groupBy(models.family)
    .orderBy(sql`count(*) DESC`)
    .limit(10);

  console.log("\n📊 Catalog Coverage Report\n");
  console.log(`Total Models: ${totalModels[0].count}`);
  console.log(`Matched: ${matchedModels[0].count} (${((matchedModels[0].count / totalModels[0].count) * 100).toFixed(1)}%)`);
  console.log(`Catalog Entries: ${totalCatalog[0].count}\n`);

  console.log("Match Sources:");
  for (const row of bySource) {
    console.log(`  ${row.source}: ${row.count}`);
  }

  console.log("\nTop 10 Unmatched Families:");
  for (const row of unmatchedByFamily) {
    console.log(`  ${row.family ?? "(null)"}: ${row.count}`);
  }
}

analyze().catch(console.error);
```

**验收标准**:
- ✅ 脚本执行成功
- ✅ 输出清晰的覆盖率统计
- ✅ 能识别未匹配的模型族

---

### Task 5: 文档更新 (优先级: 低)

**目标**: 记录 models.dev 集成细节

#### 步骤

**Step 5.1**: 创建第三方许可文件

`LICENSE.third-party.md`:

```markdown
# Third-Party Licenses

## models.dev

**Source**: https://github.com/anomalyco/models.dev  
**License**: MIT  
**Used in**: 
- `packages/catalog/src/upstream/family.ts`
- `packages/catalog/src/upstream/normalize.ts`
- `packages/catalog/src/upstream/stable.ts`

MIT License

Copyright (c) 2024 Anomaly Labs, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction...

---

[其他依赖...]
```

**Step 5.2**: 更新 README

在 `README.md` 中添加：

```markdown
## Data Sources

OpenHub integrates with [models.dev](https://models.dev) - an open-source model catalog:

- **Daily Sync**: Automatic synchronization from `https://models.dev/api/v0/models.json`
- **Offline Fallback**: Built-in snapshot for offline deployments
- **Coverage**: 500+ models from 100+ providers
- **License**: models.dev is MIT licensed

See `LICENSE.third-party.md` for attribution details.
```

---

## 📊 优先级总结

| Task | 优先级 | 预计工时 | 影响范围 |
|------|-------|---------|---------|
| Task 1: 更新内置快照 | ⚡ 高 | 1-2 小时 | 提升离线部署覆盖率 |
| Task 2: 复用工具函数 | 🟡 中 | 2-3 小时 | 代码复用，减少维护 |
| Task 3: 定时同步 | 🟡 中 | 2-3 小时 | 生产环境数据新鲜度 |
| Task 4: 分析工具 | 🔵 低 | 1 小时 | 运维可观测性 |
| Task 5: 文档更新 | 🔵 低 | 30 分钟 | 合规与可维护性 |

---

## ✅ 验收标准

### 整体验收

1. **功能完整性**
   - ✅ 原有 57/57 E2E 测试仍然通过
   - ✅ 目录快照包含 500+ 模型
   - ✅ 定时同步正常运行（生产环境）

2. **代码质量**
   - ✅ TypeScript 类型检查无错误
   - ✅ 无 lint 警告
   - ✅ 第三方代码正确标注许可

3. **文档完整性**
   - ✅ LICENSE.third-party.md 存在
   - ✅ README 包含数据源说明
   - ✅ 本执行计划已归档

---

## 🚫 不需要做的事

基于项目已完成的状态，以下事项**不需要执行**：

1. ❌ **不需要重写 schema 定义** - 项目已有完整的 Zod schema
2. ❌ **不需要重新实现同步逻辑** - `perform.ts` 已完整实现 ETL
3. ❌ **不需要克隆 models.dev 仓库** - Windows 不支持，必须用 JSON API
4. ❌ **不需要修改数据库 schema** - 表结构已完整且稳定
5. ❌ **不需要重写前端组件** - Wizard 等页面已完整实现

---

## 📝 执行记录

| 日期 | Task | 执行者 | 状态 | 备注 |
|------|------|-------|------|------|
| 2026-08-17 | Task 1 | - | 待执行 | 快照更新 |
| 2026-08-17 | Task 2 | - | 待执行 | 代码复用 |
| 2026-08-17 | Task 3 | - | 待执行 | 定时同步 |
| 2026-08-17 | Task 4 | - | 待执行 | 分析工具 |
| 2026-08-17 | Task 5 | - | 待执行 | 文档补充 |

---

## 🎯 下一步建议

完成以上 Task 后，建议：

1. **生产部署前检查清单**
   - [ ] 环境变量配置（`MODELS_DEV_URL`, `CATALOG_SYNC_CRON`）
   - [ ] 数据库备份策略
   - [ ] 监控告警配置（同步失败通知）

2. **长期维护建议**
   - 每季度手动检查 models.dev API schema 是否有 breaking change
   - 每月运行覆盖率分析工具
   - 关注 models.dev 仓库的 release notes

3. **潜在扩展方向**
   - 支持多个目录源（备用 models.dev mirror）
   - 添加目录数据审计日志
   - 前端展示模型来源（models.dev vs 人工添加）

---

**文档版本**: v1.0  
**最后更新**: 2026-08-17 04:15 AM  
**作者**: Claude (Kiro)  
**基于**: OpenHub DESIGN.md v4084 + models.dev MIT 仓库
