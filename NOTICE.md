# Third-Party Licenses

This document lists all third-party software used by OpenHub and their respective licenses.

---

## models.dev

- **Repository**: https://github.com/anomalyco/models.dev
- **License**: MIT
- **Author**: Anomaly Labs, Inc.
- **Used by**: OpenHub catalog sync engine

### MIT License

```
MIT License

Copyright (c) 2024 Anomaly Labs, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Files Adapted from models.dev

| OpenHub File | Source Path | Type |
|---|---|---|
| `packages/catalog/src/upstream/schema.ts` | `packages/core/src/schema.ts` | Schema definitions (modified) |
| `packages/catalog/src/upstream/stable.ts` | `packages/core/src/sync/index.ts` | Utility function |
| `packages/catalog/src/upstream/family.ts` | `packages/core/src/family.ts` | Family enum + helpers |
| `packages/catalog/src/upstream/omit.ts` | `packages/core/src/generate.ts` | Utility function |
| `packages/server/src/engine/capability/catalog-snapshot.json` | `https://models.dev/models.json` | Data snapshot (250+ models) |

### Data Source Attribution

OpenHub consumes the following public JSON endpoints provided by models.dev:

- `https://models.dev/api.json` — Provider-specific data (pricing, capabilities)
- `https://models.dev/models.json` — Provider-agnostic model metadata

The built-in snapshot (`catalog-snapshot.json`) is generated from `models.json` and refreshed on each release of OpenHub.

---

## Other Dependencies

OpenHub uses many open-source npm packages. See `pnpm-lock.yaml` for the complete dependency tree and their respective licenses.

Key dependencies:

| Package | License | Purpose |
|---|---|---|
| hono | MIT | HTTP framework |
| drizzle-orm | Apache-2.0 | Database ORM |
| better-sqlite3 | MIT | SQLite driver |
| zod | MIT | Schema validation |
| nanoid | MIT | ID generation |
| react | MIT | UI framework |
| vite | MIT | Build tool |

---

**Document Version**: v1.0  
**Last Updated**: 2026-08-17
