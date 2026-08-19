# OpenHub 整改方案

> 基于代码审查与 GAP-ANALYSIS.md，制定时间：2026-08-17

---

## 一、问题汇总

| # | 问题 | 严重程度 | 根本原因 | 影响范围 |
|---|---|---|---|---|
| P1 | `model_catalog` 只有 50 条，应有 ~342 条 | 🔴 致命 | 同步超时 5 秒 + 仅 production 触发 | 能力识别失效 |
| P2 | `model_catalog_alias` 表为空 | 🔴 致命 | 别名生成器从未实现 | 四步匹配第 3 步完全失效 |
| P3 | 开发环境永不同步 | 🔴 致命 | `startCatalogSyncCron` 硬判 `NODE_ENV=production` | 本地调试时数据始终为空 |
| P4 | 覆盖率计算错误，显示"100% 匹配" | 🟡 严重 | 计算逻辑只统计已有记录 | 管理员无法感知真实匹配率 |
| P5 | 无初始化脚本 | 🟡 严重 | 缺少 `scripts/init.ts` | 新部署须手动操作多步 |
| P6 | `family` 推断规则不完整 | 🟢 一般 | `defaultFamilyInferrers` 仅覆盖主流模型 | 小众模型关键词匹配失败 |

---

## 二、整改任务

### P1 + P3：修复同步超时与开发环境限制

**问题代码（`packages/catalog/src/sync/perform.ts:85`）：**
```typescript
// 当前：5 秒，拉取大 JSON 容易超时
signal: AbortSignal.timeout(5000),
```

**问题代码（`packages/server/src/jobs/catalog-sync-cron.ts:73`）：**
```typescript
// 当前：开发环境完全跳过
if (process.env.NODE_ENV !== "production") {
  console.log("[cron] catalog sync disabled (NODE_ENV != production)");
  return;
}
```

**整改内容：**

① `packages/catalog/src/sync/perform.ts` 第 85 行：

```typescript
// 改为 30 秒，models.dev JSON 约 200–400 KB
signal: AbortSignal.timeout(Number(process.env.CATALOG_SYNC_TIMEOUT_MS ?? 30_000)),
```

② `packages/server/src/jobs/catalog-sync-cron.ts` 第 73 行：

```typescript
// 改为：生产环境走定时器，其他环境启动后只触发一次（不重复）
if (process.env.NODE_ENV !== "production") {
  console.log("[cron] catalog sync: one-shot mode (non-production)");
  setTimeout(() => {
    runCatalogSync().catch((e) =>
      console.error("[cron] one-shot sync error:", e),
    );
  }, 5_000);
  return;
}
```

---

### P2：实现别名生成器

**新建文件：`packages/catalog/src/sync/generate-aliases.ts`**

```typescript
/**
 * 同步后为每条 catalog 记录生成别名，写入 model_catalog_alias 表
 *
 * 别名类型（aliasType）：
 *   exact       - catalog.id 本身（最高优先级）
 *   provider_id - 去掉厂商前缀（openai/gpt-4o → gpt-4o）
 *   slug        - 常见变体（gpt-4o → gpt_4o、gpt4o）
 *   legacy      - 已知旧名（gpt-4-turbo-preview → openai/gpt-4-turbo）
 */

import { nanoid } from "nanoid";

export interface AliasEntry {
  id: string;
  catalogId: string;
  alias: string;
  normalized: string;
  aliasType: "exact" | "provider_id" | "slug" | "legacy";
  priority: number;
}

export interface AliasDb {
  clearAliases(): Promise<void>;
  insertAliases(rows: AliasEntry[]): Promise<void>;
}

/** 与 match-model.ts 保持一致 */
function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/[_\-\/]/g, " ").replace(/\s+/g, " ");
}

/** slug 变体：把 - 换成 _，或全部去掉分隔符 */
function slugVariants(id: string): string[] {
  const base = id.includes("/") ? id.split("/")[1] : id;
  return [
    base.replace(/-/g, "_"),     // gpt-4o → gpt_4o
    base.replace(/[-_]/g, ""),   // gpt-4o → gpt4o
  ].filter((v) => v !== base);
}

/** 已知旧名映射表 */
const LEGACY_MAP: Record<string, string[]> = {
  "openai/gpt-4-turbo":          ["gpt-4-turbo-preview", "gpt-4-1106-preview", "gpt-4-0125-preview"],
  "openai/gpt-4o":               ["chatgpt-4o", "gpt-4o-2024-08-06", "gpt-4o-2024-05-13"],
  "openai/gpt-4o-mini":          ["gpt-4o-mini-2024-07-18"],
  "openai/gpt-3.5-turbo":        ["gpt-3.5-turbo-0125", "gpt-3.5-turbo-1106"],
  "anthropic/claude-3-opus":     ["claude-3-opus-20240229", "claude-opus"],
  "anthropic/claude-3-sonnet":   ["claude-3-sonnet-20240229"],
  "anthropic/claude-3-haiku":    ["claude-3-haiku-20240307"],
  "anthropic/claude-3-5-sonnet": ["claude-3-5-sonnet-20240620", "claude-3-5-sonnet-20241022"],
  "anthropic/claude-3-5-haiku":  ["claude-3-5-haiku-20241022"],
  "google/gemini-1.5-pro":       ["gemini-1.5-pro-latest", "gemini-1.5-pro-002"],
  "google/gemini-1.5-flash":     ["gemini-1.5-flash-latest", "gemini-1.5-flash-002"],
  "google/gemini-2.0-flash":     ["gemini-2.0-flash-exp"],
};

export async function generateAliases(
  db: AliasDb,
  catalogs: Array<{ id: string }>,
): Promise<number> {
  const rows: AliasEntry[] = [];
  const seen = new Set<string>(); // 防止同一 alias 重复插入

  for (const cat of catalogs) {
    const push = (
      alias: string,
      type: AliasEntry["aliasType"],
      priority: number,
    ) => {
      const key = alias.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      rows.push({
        id: nanoid(),
        catalogId: cat.id,
        alias,
        normalized: normalize(alias),
        aliasType: type,
        priority,
      });
    };

    // 1. exact
    push(cat.id, "exact", 10);

    // 2. provider_id
    if (cat.id.includes("/")) {
      push(cat.id.split("/")[1], "provider_id", 20);
    }

    // 3. slug
    for (const s of slugVariants(cat.id)) {
      push(s, "slug", 30);
    }

    // 4. legacy
    for (const old of LEGACY_MAP[cat.id] ?? []) {
      push(old, "legacy", 40);
    }
  }

  await db.clearAliases();
  await db.insertAliases(rows);
  return rows.length;
}
```

---

### P2（续）：将别名生成器接入同步流程

**修改 `packages/server/src/engine/catalog/db-adapter.ts`，追加 `aliasDb` 导出：**

```typescript
import { modelCatalogAlias } from "../../db/schema/index";
import type { AliasDb, AliasEntry } from "@openhub/catalog/sync/generate-aliases";

export const aliasDb: AliasDb = {
  async clearAliases() {
    await db.delete(modelCatalogAlias);
  },
  async insertAliases(rows: AliasEntry[]) {
    if (rows.length === 0) return;
    // SQLite 单次 INSERT 上限约 999 个绑定变量，按 200 条分批
    const BATCH = 200;
    for (let i = 0; i < rows.length; i += BATCH) {
      await db.insert(modelCatalogAlias).values(rows.slice(i, i + BATCH) as any);
    }
  },
};
```

**修改 `packages/server/src/jobs/catalog-sync-cron.ts`，同步成功后自动生成别名：**

```typescript
import { generateAliases } from "@openhub/catalog/sync/generate-aliases";
import { aliasDb } from "../engine/catalog/db-adapter.js";
import { modelCatalog } from "../db/schema/index.js";

// 在 runCatalogSync() 的 result.status === "success" 分支内，重新匹配前插入：
const catalogs = await db.select({ id: modelCatalog.id }).from(modelCatalog);
const aliasCount = await generateAliases(aliasDb, catalogs);
console.log(`[cron] generated ${aliasCount} aliases`);
```

---

### P2（续）：补充手动触发接口

**修改 `packages/server/src/routes/admin/catalog.ts`，增加两个端点：**

```typescript
// POST /admin/catalog/generate-aliases
// 手动重新生成所有别名（无需重新同步）
catalog.post("/catalog/generate-aliases", async (c) => {
  const cats = await db.select({ id: modelCatalog.id }).from(modelCatalog);
  const count = await generateAliases(aliasDb, cats);
  return c.json({ data: { generated: count } });
});

// POST /admin/catalog/rematch-all
// 手动触发所有站点重新匹配（别名生成后使用）
catalog.post("/catalog/rematch-all", async (c) => {
  const allSites = await db.select({ id: sites.id }).from(sites);
  let matched = 0, unmatched = 0;
  for (const s of allSites) {
    const r = await matchModelsForSite(s.id);
    matched += r.matched;
    unmatched += r.unmatched;
  }
  return c.json({ data: { matched, unmatched } });
});
```

---

### P4：修正覆盖率计算

**修改 `packages/server/src/routes/admin/catalog.ts` 的 stats 端点（或相关工具）：**

```typescript
// GET /admin/catalog/stats
catalog.get("/catalog/stats", async (c) => {
  const [catalogCount] = await db.select({ count: count() }).from(modelCatalog);
  const [aliasCount]   = await db.select({ count: count() }).from(modelCatalogAlias);
  const [matched]      = await db.select({ count: count() }).from(models)
                           .where(isNotNull(models.catalogModelId));
  const [unmatched]    = await db.select({ count: count() }).from(models)
                           .where(isNull(models.catalogModelId));
  const total = matched.count + unmatched.count;

  return c.json({
    data: {
      catalog: {
        actual:   catalogCount.count,
        expected: 342,              // models.dev 快照基准
        ratio:    `${((catalogCount.count / 342) * 100).toFixed(1)}%`,
      },
      aliases: {
        count: aliasCount.count,
      },
      models: {
        total,
        matched:   matched.count,
        unmatched: unmatched.count,
        matchRate: total > 0
          ? `${((matched.count / total) * 100).toFixed(1)}%`
          : "0.0%",
      },
    },
  });
});
```

---

### P5：编写初始化脚本

**新建 `packages/server/scripts/init.ts`**

```typescript
#!/usr/bin/env tsx
/**
 * 新部署初始化脚本
 * 用法：pnpm --filter @openhub/server init
 *
 * 步骤：
 *  1. 拉取 models.dev 目录
 *  2. 生成别名
 *  3. 触发所有站点重新匹配
 *  4. 打印覆盖率报告
 */

import { performSync } from "@openhub/catalog/sync";
import { generateAliases } from "@openhub/catalog/sync/generate-aliases";
import { syncDb, aliasDb } from "../src/engine/catalog/db-adapter";
import { matchModelsForSite } from "../src/engine/catalog/match-after-discover";
import { db } from "../src/db/index";
import { modelCatalog, sites, models } from "../src/db/schema/index";
import { isNotNull, isNull, count } from "drizzle-orm";

async function main() {
  console.log("\n=== OpenHub 初始化 ===\n");

  // 1. 同步目录
  process.stdout.write("1. 同步 models.dev 目录... ");
  const syncResult = await performSync(syncDb);
  if (syncResult.status !== "success") {
    console.error(`\n   ✗ 同步失败：${syncResult.errorMessage}`);
    process.exit(1);
  }
  console.log(`✓  total=${syncResult.total} added=${syncResult.added} updated=${syncResult.updated}`);

  // 2. 生成别名
  process.stdout.write("2. 生成模型别名... ");
  const cats = await db.select({ id: modelCatalog.id }).from(modelCatalog);
  const aliasCount = await generateAliases(aliasDb, cats);
  console.log(`✓  generated=${aliasCount}`);

  // 3. 重新匹配
  process.stdout.write("3. 匹配所有站点模型... ");
  const allSites = await db.select({ id: sites.id }).from(sites);
  let totalMatched = 0, totalUnmatched = 0;
  for (const s of allSites) {
    const r = await matchModelsForSite(s.id);
    totalMatched   += r.matched;
    totalUnmatched += r.unmatched;
  }
  console.log(`✓  matched=${totalMatched} unmatched=${totalUnmatched}`);

  // 4. 覆盖率报告
  const [m] = await db.select({ count: count() }).from(models).where(isNotNull(models.catalogModelId));
  const [u] = await db.select({ count: count() }).from(models).where(isNull(models.catalogModelId));
  const total = m.count + u.count;
  const rate  = total > 0 ? ((m.count / total) * 100).toFixed(1) : "0.0";

  console.log(`
=== 初始化完成 ===
目录记录：${cats.length} / 342（预期）
别名记录：${aliasCount}
模型总数：${total}
已匹配：  ${m.count}（${rate}%）
未匹配：  ${u.count}
`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

在 `packages/server/package.json` 的 `scripts` 中增加：

```json
"init": "tsx scripts/init.ts"
```

---

### P6：扩展 family 推断规则（可选）

**修改 `packages/catalog/src/matcher/match-model.ts`，在 `defaultFamilyInferrers` 中补充规则：**

```typescript
// 追加到 defaultFamilyInferrers 函数中
if (/qwen[-_ ]?\d/i.test(lower))             return "qwen";
if (/llama[-_ ]?\d/i.test(lower))            return "llama";
if (/mistral/i.test(lower))                  return "mistral";
if (/stable[-_ ]?diffusion/i.test(lower))    return "stable-diffusion";
if (/flux/i.test(lower))                     return "flux";
if (/wan[-_ ]?2/i.test(lower))               return "wan";
if (/kling[-_ ]?v?\d/i.test(lower))          return "kling";
if (/sora/i.test(lower))                     return "sora";
if (/step[-_ ]?\d|step1/i.test(lower))       return "stepfun";
if (/hunyuan/i.test(lower))                  return "hunyuan";
if (/doubao/i.test(lower))                   return "doubao";
if (/minimax|abab\d/i.test(lower))           return "minimax";
```

---

## 三、执行顺序

```
阶段 1（今天，约 2 小时）
  ├── 修改 perform.ts：超时 5s → 30s
  ├── 修改 catalog-sync-cron.ts：非生产环境允许一次性同步
  └── 手动触发 POST /admin/catalog/sync，验证 model_catalog 达到 ~342 条

阶段 2（明天，约 4 小时）
  ├── 新建 generate-aliases.ts
  ├── db-adapter.ts 追加 aliasDb
  ├── catalog-sync-cron.ts 接入别名生成
  ├── 增加 /admin/catalog/generate-aliases 接口
  └── 触发 POST /admin/catalog/generate-aliases，验证别名表非空

阶段 3（后天，约 2 小时）
  ├── 触发 POST /admin/catalog/rematch-all
  ├── 修正 /admin/catalog/stats 覆盖率计算
  └── 验证匹配率 ≥ 80%

阶段 4（本周内）
  ├── 编写 scripts/init.ts
  ├── 补充 family 推断规则（P6）
  └── 更新 README 部署说明
```

---

## 四、验证检查点

| 阶段完成后 | 预期结果 | 验证命令 |
|---|---|---|
| 阶段 1 | `model_catalog` ≥ 300 条 | `GET /admin/catalog/stats` |
| 阶段 2 | `model_catalog_alias` ≥ 1000 条 | `GET /admin/catalog/stats` |
| 阶段 3 | 匹配率 ≥ 80% | `GET /admin/catalog/stats` |
| 阶段 4 | `pnpm init` 一键完成全流程 | 新环境执行 `pnpm --filter @openhub/server init` |

---

## 五、风险与注意事项

1. **别名冲突**：不同 catalog 条目可能生成相同别名（如两个供应商都有 `gpt-4o`）。`generate-aliases.ts` 中的 `seen` Set 会跳过重复别名，优先保留先写入的记录——建议按 `id` 字母排序 catalogs 后再生成，确保结果稳定可预期。

2. **SQLite 批量写入**：`insertAliases` 按 200 条分批，避免超过 SQLite 绑定变量上限（999）。如果后续迁移到 PostgreSQL，可以提高批量大小。

3. **同步源不稳定**：`models.dev/models.json` 是外部依赖，格式可能变化。`perform.ts` 的 Schema 验证失败时会中断同步并写 `status=failed`，不会破坏现有数据，这个保护机制已经正确实现。

4. **生产环境重新匹配**：`rematch-all` 会逐条更新 `models` 表，站点模型数量多时耗时较长。建议在低峰期执行，或后续改为批量更新。
