# @openhub/catalog

OpenHub 的 models.dev 目录同步与匹配逻辑，独立 workspace 包。

## 目录结构

```
src/
├── upstream/          # 复用自 models.dev（MIT License）
│   ├── schema.ts      # Zod 字段定义（CatalogItemSchema 等）
│   ├── family.ts      # ModelFamilyValues 枚举 + inferKimiFamily
│   ├── stable.ts      # 对象稳定序列化函数（用于语义对比）
│   └── omit.ts        # 按点路径深度删除字段
├── sync/              # 自研：目录同步 ETL
│   ├── perform.ts     # performSync(db, options) —— 依赖注入式
│   ├── catalog-to-fields.ts  # CatalogItem → DB row 字段映射
│   └── types.ts       # SyncResult / MatchResult 等类型
└── matcher/           # 自研：四步匹配算法
    └── match-model.ts # exact → normalized → alias → keyword
```

## 设计原则

- **不反向依赖 server**：catalog 包定义抽象接口（SyncDb / MatcherDb），server 包实现
- **上游代码集中放 upstream/**：复制自 models.dev，每个文件顶部保留 MIT 版权声明
- **自研代码用 sync/ matcher/**：与上游代码物理隔离，便于升级时只替换 upstream/

## 使用示例

```typescript
import { performSync } from "@openhub/catalog/sync";
import { matchModel } from "@openhub/catalog/matcher";
import { inferKimiFamily } from "@openhub/catalog/upstream/family";

const result = await performSync(myDbAdapter, { url: "https://..." });
const match = await matchModel(myMatcherAdapter, "kimi-k2-thinking", {
  customInferrers: [(name) => inferKimiFamily(name)],
});
```

## 升级上游

当 models.dev 更新 schema 时，只需替换 `upstream/*.ts` 文件，业务逻辑不变。
`performSync` 通过 Zod `.passthrough()` 容忍新字段，不会因上游加字段而失败。

## 许可证

本包内 `upstream/*` 文件来自 https://github.com/anomalyco/models.dev (MIT License)。
`sync/` 和 `matcher/` 是 OpenHub 自研代码。
