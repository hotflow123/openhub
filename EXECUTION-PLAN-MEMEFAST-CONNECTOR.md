# MemeFast Connector Implementation Plan

> **已由 `EXECUTION-PLAN-MEMEFAST-MASTER.md` 取代。**
> 本文件保留作历史记录；后续以主计划为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` or execute this plan task-by-task with a review checkpoint after each task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable, backend-only MemeFast connector that accepts a MemeFast base URL and API key, discovers available models, uses the OpenHub catalog for safe parameter assistance, and exposes stable OpenAI-compatible operations without copying MemeFast's entire native API surface.

**Architecture:** Create a small standalone `@openhub/memefast` core package with no database or Hono dependency. Add a thin `memefast` adapter to OpenHub that reuses the core package, preserves the existing site/model/variant/task model, and fixes adapter inheritance during discovery. Treat upstream capabilities as runtime truth and the OpenHub catalog as documented assistance and candidate metadata, never as an unconditional provider contract.

**Tech Stack:** TypeScript, native `fetch`, `AbortSignal.timeout`, existing `zod`, Node `node:test`, Drizzle SQLite schema already used by OpenHub, existing OpenHub adapter registry.

## Global Constraints

- P0 supports only verified OpenAI-compatible discovery and standard Chat, streaming Chat, Embedding, Image Generation, Audio Speech, and Audio Transcription operations.
- P0 does not implement all MemeFast native endpoints, arbitrary path execution, a plugin marketplace, a workflow engine, or per-end-user credential management.
- API keys remain server-side, are never returned by API responses, are never written to logs, and are never placed in browser storage or frontend bundles.
- The server validates user-supplied upstream URLs with the existing SSRF protection; only `http://` and `https://` are accepted.
- URL normalization must prevent duplicate `/v1` segments while preserving a deliberate non-root deployment path.
- A missing required parameter is an error; the connector must not invent prompts, media, voices, durations, or other business values.
- Unknown top-level parameters must not be silently discarded. They either produce a structured validation error or are explicitly placed in `provider_options.memefast`.
- Parameter evidence priority is: manual confirmation or measured result > MemeFast runtime metadata/probe > MemeFast documentation > OpenHub catalog > generic defaults.
- Catalog matches are marked with source and confidence. Candidate catalog data can drive UI suggestions but cannot activate runtime limits until confirmed.
- No new runtime dependency is added when native `fetch`, existing `zod`, and existing database utilities are sufficient.
- Do not automatically publish every discovered model as a public OpenHub variant; model exposure remains an explicit administrative decision because model calls may consume paid quota.
- Do not commit changes automatically. Each task ends with a local verification checkpoint.

---

## 0. Independent Analysis

### Confirmed Facts

| ID | Fact | Evidence |
|---|---|---|
| F1 | OpenHub has a site-level `adapterId`, encrypted upstream key storage, and a registered adapter system. | `packages/server/src/db/schema/sites.ts`, `packages/server/src/engine/adapter.ts`, `packages/server/src/engine/index.ts` |
| F2 | The existing OpenAI adapter already forwards Chat, streaming Chat, Embedding, Image, Audio, and generic asynchronous Video requests. | `packages/server/src/engine/adapters/openai.ts` |
| F3 | Model discovery hardcodes `${baseUrl}/v1/models` and does not write the selected site adapter into new model rows. | `packages/server/src/engine/discover.ts` |
| F4 | Route resolution gives `model.adapterId` priority over `site.adapterId`; the model schema defaults to `openai-compatible`. A new `memefast` site can therefore be routed through the OpenAI adapter instead. | `packages/server/src/db/schema/models.ts`, `packages/server/src/routes/router.ts`, `packages/server/src/engine/adapter.ts` |
| F5 | Existing discovery skips an already-known model instead of refreshing its adapter, metadata, status, or observed capabilities. | `packages/server/src/engine/discover.ts` |
| F6 | OpenHub public `/v1/models` exposes variants, not raw discovered models. The current hosted flow therefore requires an administrator to create a variant before an external caller can use a model. | `packages/server/src/routes/v1/models.ts`, `packages/server/src/routes/admin/variants.ts` |
| F7 | Confirmed Schema data is used for runtime validation; candidate associations are intentionally not used as provider contracts. | `packages/server/src/lib/model-contract.ts`, `packages/server/src/engine/catalog/schema-matcher.ts` |
| F8 | The existing parameter mapper can drop unknown fields by allow-list filtering, which is unsafe for a connector that promises usable parameter feedback. | `packages/server/src/engine/param-mapper.ts` |

### Reasonable Inferences

| ID | Inference | Design consequence |
|---|---|---|
| I1 | The primary integration case is a website or software backend configured with one MemeFast connection, not arbitrary browser-side users entering secrets. | P0 provides a backend SDK and OpenHub site adapter; per-user credential tenancy is deferred. |
| I2 | A reusable SDK cannot depend on OpenHub's SQLite database or Hono routes. | The protocol client and contract resolver are separated from OpenHub persistence. |
| I3 | MemeFast may expose a broad set of provider-specific operations, but one key may not have access to every model or modality. | Discovery and live smoke tests determine capability; documentation alone does not enable an operation. |

### Unverified Assumptions

These are validation tasks, not permission to guess:

1. Verify the exact MemeFast response envelope for `/v1/models`, including whether model metadata contains modality, capabilities, or input Schema.
2. Verify authentication and URL behavior with a non-production MemeFast key for a base URL with and without a trailing `/v1`.
3. Verify Chat non-streaming, Chat streaming, Image Generation, Embedding, Audio Speech, and Audio Transcription separately; an account may not expose all six.
4. Record actual MemeFast error envelopes and request IDs. The connector must parse observed fields and preserve unknown error details without exposing the API key.
5. Do not start P1 video/native work until its submit, status, result, and callback shapes are captured from a real test account or a deterministic mock based on confirmed documentation.

### Final Scope Decision

The deliverable is **MemeFast Connector Core + OpenHub MemeFast Adapter**, not a generic provider framework. The core is the reusable product. OpenHub is one host integration that adds encrypted storage, variants, virtual keys, catalog persistence, and task persistence around the core.

---

## 1. Boundary and Acceptance Criteria

### P0 Included

- Backend configuration with `baseUrl` and `apiKey`.
- Canonical URL building and `/v1` de-duplication.
- Connection verification and model discovery.
- Exact and unambiguous normalized model lookup.
- Model profile with capability and parameter evidence.
- OpenHub catalog-assisted parameter suggestions and safe defaults.
- Structured validation errors for missing, invalid, unsupported, and unknown parameters.
- OpenAI-compatible Chat, streaming Chat, Embedding, Image Generation, Audio Speech, and Audio Transcription.
- OpenHub adapter registration and adapter-aware discovery.
- Existing variant routing preserved for hosted OpenHub use.
- Standalone package documentation and mock-based tests.

### P1 Deferred Until P0 Passes

- MemeFast asynchronous Video submit/query/wait/callback support.
- Reference-media upload and remote media retrieval helpers.
- A small, explicitly enumerated set of native high-value operations backed by static manifests.
- Catalog snapshot refresh automation for released SDK versions.

### Explicit Non-Goals

- Dynamic execution of arbitrary method/path combinations supplied by callers.
- Automatic guessing of model parameters from a family name alone.
- Automatic public exposure of every discovered model.
- Browser-side API-key handling.
- New Redis, message queue, or multi-tenant credential subsystem in P0.
- Rewriting all existing provider adapters.

### P0 Acceptance Test

The implementation passes only when this flow works against a mock and, where credentials permit, a real non-production MemeFast connection:

```text
create connector(baseUrl, apiKey)
  -> verify() succeeds
  -> discover() returns models
  -> profile(modelId) reports evidence
  -> chat()/stream()/embedding()/image()/audio() use the discovered model
  -> invalid input fails before upstream call
  -> upstream error becomes a structured MemeFastError
```

For OpenHub, a newly discovered model must use the site adapter, an explicitly manually overridden model must retain its manual adapter, and an existing site-sourced model must refresh when the site adapter changes.

---

## 2. File Map

### New Reusable Package

- Create: `packages/memefast/package.json` — package metadata and `test`/`typecheck` scripts.
- Create: `packages/memefast/tsconfig.json` — extends the repository TypeScript base configuration.
- Create: `packages/memefast/src/types.ts` — public connector, model, contract, operation, and response types.
- Create: `packages/memefast/src/url.ts` — URL parsing, canonicalization, and endpoint construction.
- Create: `packages/memefast/src/errors.ts` — structured transport, validation, and upstream errors.
- Create: `packages/memefast/src/transport.ts` — authenticated JSON/stream requests with timeouts and response parsing.
- Create: `packages/memefast/src/catalog.ts` — catalog resolver interface and evidence merge rules.
- Create: `packages/memefast/src/client.ts` — `createMemeFastConnector()` and standard operations.
- Create: `packages/memefast/src/index.ts` — public exports only.
- Create: `packages/memefast/test-connector.ts` — native `node:test` coverage using a mocked `fetch`.
- Create: `packages/memefast/README.md` — backend integration instructions and security constraints.

### Shared Catalog Contract

- Modify: `packages/catalog/src/index.ts` — export source-neutral contract types and snapshot resolver.
- Create: `packages/catalog/src/contract.ts` — `InputContract`, `CatalogResolution`, `ContractEvidence`, and `CatalogResolver`.
- Create: `packages/catalog/src/snapshot.ts` — deterministic snapshot lookup and alias matching.
- Create: `packages/memefast/data/catalog.snapshot.json` — generated compact model/Schema snapshot used by standalone integrations.
- Create: `packages/server/src/scripts/export-memefast-catalog.ts` — export the current OpenHub catalog into the compact snapshot format.
- Modify: `packages/server/package.json` — add `catalog:export:memefast`.

### OpenHub Integration

- Modify: `packages/server/src/engine/adapter.ts` — add an optional adapter-owned remote model discovery method and model adapter provenance types.
- Create: `packages/server/src/engine/adapters/memefast.ts` — thin wrapper around `@openhub/memefast`.
- Modify: `packages/server/src/engine/index.ts` — register the canonical `memefast` adapter.
- Modify: `packages/server/src/engine/adapters/openai.ts` — retain standard behavior and expose the common model discovery path where needed.
- Modify: `packages/server/src/engine/discover.ts` — use the selected adapter, persist adapter provenance, refresh existing models, and mark missing models without overwriting manual fields.
- Modify: `packages/server/src/db/schema/models.ts` — add `adapterSource` with `site` and `manual` values.
- Generate: the next timestamped SQL migration under `packages/server/drizzle/` — adds `adapter_source` and performs the legacy data backfill without recreating the models table.
- Modify: `packages/server/src/routes/router.ts` — resolve site-sourced models from the site adapter and manual-sourced models from the model adapter.
- Modify: `packages/server/src/routes/admin/sites.ts` — validate registered adapters and pass the selected adapter into discovery.
- Modify: `packages/server/src/routes/admin/models.ts` — allow explicit manual adapter override and record `adapterSource=manual`.
- Modify: `packages/web/src/pages/Sites.tsx` — add the `memefast` adapter option and show that the key is stored server-side.

### Tests and Documentation

- Modify: `packages/server/test-param-mapper.ts` — verify unknown provider fields are surfaced rather than silently dropped in the MemeFast path.
- Create: `packages/server/test-memefast-adapter.ts` — verify registry, discovery, adapter inheritance, and request forwarding.
- Modify: `packages/server/package.json` — include the new adapter test in the server test script.
- Modify: `README.md` — link to the supported MemeFast integration modes documented in `packages/memefast/README.md`.

---

## 3. P0 Execution Plan

### Task 1: Freeze the External Contract with Mock Tests

**Files:**
- Create: `packages/memefast/package.json`
- Create: `packages/memefast/tsconfig.json`
- Create: `packages/memefast/test-connector.ts`

**Interfaces:**
- Produces the test contract for `createMemeFastConnector`, `verify`, `discover`, and structured errors.

- [ ] **Step 1: Create the package shell**

Use the existing repository conventions:

```json
{
  "name": "@openhub/memefast",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "tsx --test test-connector.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { "zod": "^3.23.0" },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0"
  }
}
```

Create `tsconfig.json` with `extends: "../../tsconfig.base.json"`, `rootDir: "src"`, `module: "ESNext"`, `moduleResolution: "Bundler"`, `noEmit: true`, and include both `src/**/*` and `test-connector.ts`.

- [ ] **Step 2: Write failing discovery and URL tests**

The tests must replace `globalThis.fetch` and restore it in `finally`:

```ts
test("normalizes a base URL that already ends in /v1", async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    return Response.json({ object: "list", data: [{ id: "gpt-4o" }] });
  };
  try {
    const client = createMemeFastConnector({
      baseUrl: "https://mf.example.com/v1/",
      apiKey: "test-key",
    });
    await client.discover();
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(calls, ["https://mf.example.com/v1/models"]);
});
```

Add tests that assert: `Authorization: Bearer test-key` is sent, malformed model lists fail with `protocol_error`, and an upstream JSON error containing `message`, `code`, or `fail_reason` becomes a structured error without including the key.

- [ ] **Step 3: Run the new package test and verify failure**

Run:

```powershell
pnpm --filter @openhub/memefast test
```

Expected: FAIL because the public connector and transport implementation do not exist yet.

### Task 2: Implement URL, Error, and Transport Primitives

**Files:**
- Create: `packages/memefast/src/types.ts`
- Create: `packages/memefast/src/url.ts`
- Create: `packages/memefast/src/errors.ts`
- Create: `packages/memefast/src/transport.ts`
- Create: `packages/memefast/src/index.ts`

**Interfaces:**

```ts
export interface MemeFastConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  mode?: "strict" | "assist";
  fetch?: typeof globalThis.fetch;
  catalog?: CatalogResolver;
}

export interface MemeFastErrorInfo {
  operation: string;
  status?: number;
  code: string;
  upstreamCode?: string;
  requestId?: string;
  retryable: boolean;
  details?: unknown;
}

export class MemeFastError extends Error {
  readonly info: MemeFastErrorInfo;
}

export function normalizeMemeFastBaseUrl(value: string): string;
```

- [ ] **Step 1: Implement canonical URL construction**

Normalize only these forms:

```text
https://host       -> https://host/v1
https://host/      -> https://host/v1
https://host/v1    -> https://host/v1
https://host/v1/   -> https://host/v1
https://host/api/v1 -> https://host/api/v1
```

Reject empty values, credentials in the URL, unsupported protocols, and query strings or fragments. Build endpoints by resolving relative paths under the canonical prefix; never concatenate a second `/v1`.

- [ ] **Step 2: Implement one authenticated transport path**

The transport must:

```ts
requestJson<T>(operation: string, path: string, init?: RequestInit): Promise<T>
requestStream(operation: string, path: string, init?: RequestInit): Promise<Response>
```

Use `Authorization: Bearer ${apiKey}`, `Accept: application/json`, JSON content type for JSON bodies, and `AbortSignal.timeout(timeoutMs)` for non-streaming requests. Do not log request bodies or headers. Do not retry POST operations automatically. Allow the injected `fetch` in tests.

- [ ] **Step 3: Parse errors by body and status**

For non-2xx responses, inspect these fields in order and preserve the full non-secret body under `details`:

```ts
error?.message
message
fail_reason
error?.code
code
```

Use codes `timeout`, `network_error`, `upstream_http_error`, `upstream_business_error`, and `protocol_error`. Set `retryable=true` only for timeout, network failure, HTTP 408, HTTP 429, and HTTP 5xx; generation POST retry remains disabled even when retryable.

- [ ] **Step 4: Run focused tests**

Run:

```powershell
pnpm --filter @openhub/memefast test
pnpm --filter @openhub/memefast typecheck
```

Expected: URL, authentication, timeout, malformed-response, and error-redaction tests pass.

### Task 3: Add Source-Neutral Catalog Contracts

**Files:**
- Create: `packages/catalog/src/contract.ts`
- Create: `packages/catalog/src/snapshot.ts`
- Modify: `packages/catalog/src/index.ts`
- Create: `packages/server/src/scripts/export-memefast-catalog.ts`
- Modify: `packages/server/package.json`
- Create: `packages/memefast/data/catalog.snapshot.json`

**Interfaces:**

```ts
export type ContractEvidenceSource =
  | "manual"
  | "memefast_runtime"
  | "memefast_documentation"
  | "openhub_catalog"
  | "generic_default";

export interface ContractEvidence {
  source: ContractEvidenceSource;
  confidence: "confirmed" | "candidate" | "unknown";
  observedAt?: string;
  reason: string;
}

export interface InputContract {
  fields: string[];
  requiredFields: string[];
  enums: Record<string, string[]>;
  defaults: Record<string, unknown>;
}

export interface CatalogResolution {
  canonicalId: string;
  modality: "llm" | "image" | "audio" | "video" | "embedding" | "unknown";
  contract: InputContract;
  evidence: ContractEvidence;
}

export interface CatalogResolver {
  resolve(modelId: string): Promise<CatalogResolution | null>;
}
```

在 `packages/memefast/src/catalog.ts` 另外导出 `loadBundledCatalog(): CatalogResolver`；它加载 `data/catalog.snapshot.json`，再调用 `resolveFromSnapshot`，不把快照查找逻辑复制到客户端。

- [ ] **Step 1: Implement deterministic snapshot lookup**

`resolveFromSnapshot(snapshot, modelId)` must try exact ID, normalized ID, and an alias only when one result remains. It must return `null` for ambiguous aliases. It must preserve the catalog source as `openhub_catalog` with `candidate` confidence unless the snapshot entry is explicitly marked confirmed.

- [ ] **Step 2: Export the current OpenHub catalog without adding a new database table**

The export script must read existing `model_catalog`, `model_catalog_alias`, `model_schema_catalog`, and `model_schema_alias` data through the current database connection and write only the fields required by `CatalogResolution`:

```json
{
  "version": "openhub-catalog-v1",
  "source": "openhub",
  "generatedAt": "an ISO timestamp written by the exporter",
  "models": [],
  "schemas": []
}
```

Add:

```json
"catalog:export:memefast": "tsx --env-file=.env src/scripts/export-memefast-catalog.ts"
```

The script must write atomically through a temporary file in the same directory and rename it after JSON serialization succeeds.

- [ ] **Step 3: Run catalog contract tests**

Add tests for exact match, normalized match, ambiguous alias, candidate confidence, and default extraction. Run:

```powershell
pnpm --filter @openhub/server catalog:export:memefast
pnpm --filter @openhub/catalog typecheck
pnpm --filter @openhub/memefast typecheck
```

Expected: the snapshot is valid JSON, contains no API keys or request payloads, and candidate entries do not become confirmed runtime contracts.

### Task 4: Implement Discovery, Profiles, and Parameter Assistance

**Files:**
- Modify: `packages/memefast/src/types.ts`
- Modify: `packages/memefast/src/catalog.ts`
- Create: `packages/memefast/src/client.ts`
- Modify: `packages/memefast/src/index.ts`
- Modify: `packages/memefast/test-connector.ts`

**Interfaces:**

```ts
export interface DiscoveredModel {
  id: string;
  object: "model" | string;
  created?: number;
  ownedBy?: string;
  raw: unknown;
}

export interface ModelProfile {
  id: string;
  modality: "llm" | "image" | "audio" | "video" | "embedding" | "unknown";
  capabilities: string[];
  contract: InputContract;
  evidence: ContractEvidence[];
  catalogId?: string;
  readiness: "ready" | "needs_review";
}

export interface MemeFastConnector {
  verify(): Promise<{ ok: true; modelCount: number } | { ok: false; error: MemeFastErrorInfo }>;
  discover(): Promise<DiscoveredModel[]>;
  profile(modelId: string): Promise<ModelProfile>;
  chat(request: ChatRequest): Promise<ChatResponse>;
  chatStream(request: ChatRequest): Promise<Response>;
  embedding(request: EmbeddingRequest): Promise<EmbeddingResponse>;
  imageGeneration(request: ImageGenerationRequest): Promise<ImageResponse>;
  audioSpeech(request: AudioSpeechRequest): Promise<ArrayBuffer>;
  audioTranscription(request: AudioTranscriptionRequest): Promise<AudioTranscriptionResponse>;
}

export function createMemeFastConnector(config: MemeFastConfig): MemeFastConnector;
```

- [ ] **Step 1: Normalize `/v1/models` safely**

Accept only a JSON object whose `data` property is an array of objects with a non-empty string `id`. Preserve unknown model metadata under `raw`. Do not treat a successful HTTP response with an invalid envelope as a successful discovery.

- [ ] **Step 2: Build model profiles**

Use this order for profile fields:

```text
recognized MemeFast metadata
  -> injected catalog resolver
  -> modality-neutral defaults
```

Catalog matches may set `catalogId`, suggestions, and candidate contract data. They may not set `readiness=ready` or enforce provider-specific limits unless runtime metadata, manual confirmation, or a measured probe confirms them.

- [ ] **Step 3: Implement strict and assist modes**

`strict` is the default. `assist` may add safe scalar defaults and normalization warnings, but both modes must reject missing required fields and unknown top-level fields. Provider-specific fields must be placed explicitly under:

```json
{
  "provider_options": {
    "memefast": {
      "provider_field": "value"
    }
  }
}
```

Do not silently convert an ambiguous value. Return `invalid_parameter` with the field, received value, allowed values, and evidence source.

- [ ] **Step 4: Add profile and parameter tests**

Cover: exact model lookup, ambiguous normalized lookup, catalog candidate behavior, missing required field, invalid enum, unknown top-level field, explicit `provider_options.memefast`, and a safe default. Run the package test and typecheck.

### Task 5: Implement Standard MemeFast Operations

**Files:**
- Modify: `packages/memefast/src/client.ts`
- Modify: `packages/memefast/src/transport.ts`
- Modify: `packages/memefast/test-connector.ts`

**Interfaces:**

Use OpenAI-compatible request/response shapes in the public package, with the caller-facing `model` containing the discovered MemeFast model ID:

```ts
export interface ChatRequest {
  model: string;
  messages: Array<{ role: string; content: unknown; name?: string }>;
  stream?: boolean;
  [key: string]: unknown;
}

export interface EmbeddingRequest { model: string; input: string | string[]; [key: string]: unknown }
export interface ImageGenerationRequest { model: string; prompt: string; [key: string]: unknown }
export interface AudioSpeechRequest { model: string; input: string; voice: string; [key: string]: unknown }
export interface AudioTranscriptionRequest { model: string; file: Blob | string; [key: string]: unknown }
```

- [ ] **Step 1: Implement Chat and streaming Chat**

Call the canonical `/chat/completions` path, force `stream=false` for `chat`, and force `stream=true` for `chatStream`. Validate the non-stream response has `choices`; return the upstream `Response` for streaming so the host can pipe SSE without buffering it.

- [ ] **Step 2: Implement Embedding and Image Generation**

Call `/embeddings` and `/images/generations`. Validate the response envelopes contain `data` arrays. Do not retry either POST unless the caller supplied an idempotency key and the upstream contract explicitly supports it; P0 does not add automatic POST retries.

- [ ] **Step 3: Implement Audio Speech and Transcription**

Call `/audio/speech` as JSON and return the binary body. Call `/audio/transcriptions` as multipart form data, preserving `Blob` values and string file references. Never log multipart contents.

- [ ] **Step 4: Normalize response and business errors**

Use `MemeFastError` for malformed successful responses, upstream non-2xx responses, and upstream JSON business failures. Preserve the operation name and request ID when supplied by headers or body.

- [ ] **Step 5: Run operation tests**

Assert exact paths, HTTP methods, authorization headers, JSON/multipart content types, stream flag behavior, binary return behavior, and malformed response failures.

### Task 6: Integrate the Core Package into OpenHub

**Files:**
- Create: `packages/server/src/engine/adapters/memefast.ts`
- Modify: `packages/server/src/engine/adapter.ts`
- Modify: `packages/server/src/engine/index.ts`
- Modify: `packages/server/src/engine/adapters/openai.ts`
- Modify: `packages/server/package.json`

**Interfaces:**

Extend the internal adapter contract with one optional method rather than creating a second adapter registry:

```ts
export interface DiscoveredRemoteModel {
  id: string;
  object?: string;
  created?: number;
  name?: string;
  owned_by?: string;
  metadata?: Record<string, unknown>;
}

export interface Adapter {
  // existing members...
  discoverModels?(ctx: ForwardContext): Promise<DiscoveredRemoteModel[]>;
}
```

- [ ] **Step 1: Add `memefastAdapter` as a thin wrapper**

The wrapper must:

```ts
export const memefastAdapter: Adapter = {
  id: "memefast",
  capabilities: [
    "chat",
    "chat.stream",
    "embedding",
    "models.list",
    "image.generation",
    "audio.speech",
    "audio.transcription",
  ],
  // delegate discovery and standard forwarding to createMemeFastConnector()
};
```

It must not duplicate URL normalization, error parsing, or parameter logic from the core package.

- [ ] **Step 2: Register the adapter and expose the package dependency**

Add `@openhub/memefast: workspace:*` to the server package and call `registerAdapter(memefastAdapter)` in `bootstrapAdapters()`.

- [ ] **Step 3: Keep OpenAI-compatible fallback behavior**

The existing `openai` adapter remains the fallback for sites explicitly configured as OpenAI-compatible. Its behavior is not replaced by the MemeFast adapter. Shared model discovery should use the optional adapter method when available and the existing OpenAI-compatible discovery path otherwise.

- [ ] **Step 4: Run adapter registry tests**

Verify `listAdapters()` contains exactly one canonical `memefast` entry, `getAdapter("memefast")` returns it, and the wrapper forwards a mocked Chat request through the core client.

### Task 7: Fix Adapter Inheritance and Refresh Discovery

**Files:**
- Modify: `packages/server/src/db/schema/models.ts`
- Generate: the next timestamped SQL migration under `packages/server/drizzle/`
- Modify: `packages/server/src/engine/discover.ts`
- Modify: `packages/server/src/engine/adapter.ts`
- Modify: `packages/server/src/routes/router.ts`
- Modify: `packages/server/src/routes/admin/sites.ts`
- Modify: `packages/server/src/routes/admin/models.ts`

**Interfaces:**

Add the database field:

```ts
adapterSource: text("adapter_source", {
  enum: ["site", "manual"],
}).notNull().default("site"),
```

Change resolution to:

```ts
resolveAdapterForModel(
  modelAdapterId: string | null | undefined,
  modelAdapterSource: "site" | "manual" | null | undefined,
  siteAdapterId: string | null | undefined,
): { adapter: Adapter; adapterId: string } | null;
```

- [ ] **Step 1: Generate and inspect the migration**

Run:

```powershell
pnpm --filter @openhub/server db:generate
```

The migration must add `adapter_source`, backfill existing rows as `site`, and preserve existing model rows. Do not delete or recreate the models table without a verified data-preserving migration.

- [ ] **Step 2: Persist the site adapter during discovery**

Change the server discovery signature to accept the canonical site adapter ID:

```ts
discoverModels(
  siteId: string,
  baseUrl: string,
  apiKey: string,
  adapterId: string,
): Promise<{ discovered: number; updated: number; offline: number; skipped: number }>;
```

Resolve the adapter before network access. For every new model, write `adapterId` and `adapterSource="site"`. For existing models, update adapter and runtime metadata only when `adapterSource="site"`; never overwrite a manually selected adapter or manually overridden capabilities.

- [ ] **Step 3: Refresh the model set**

Build a `seenRemoteIds` set during discovery. Models belonging to the site but absent from the current response become `offline` with `statusReason="not_returned_by_upstream"`; they are not deleted. Models returned again become `active` unless manually disabled by an existing policy.

- [ ] **Step 4: Fix route resolution**

Use `site.adapterId` whenever `adapterSource !== "manual"`. Use `model.adapterId` only when `adapterSource === "manual"`. Keep the old `openai-compatible` alias normalization for legacy data.

- [ ] **Step 5: Add explicit manual override support**

Allow `PATCH /admin/models/:id` to accept a registered `adapterId`. On a valid change, write `adapterSource="manual"` and audit the change. Reject unknown adapter IDs before updating the row.

- [ ] **Step 6: Pass the adapter from site management**

In `POST /admin/sites` and `POST /admin/sites/:id/discover`, resolve and validate the selected adapter before calling discovery. Preserve the existing SSRF check in `packages/server/src/lib/ssrf.ts`.

- [ ] **Step 7: Verify the regression fix**

Test this exact sequence with a mocked MemeFast site:

```text
create site(adapterId="memefast")
  -> discover model
  -> stored model.adapterId="memefast", adapterSource="site"
  -> route resolves memefast adapter
change site adapter to "openai"
  -> rediscover updates only site-sourced model
manually set model adapter to "openai"
  -> adapterSource="manual"
  -> later site rediscovery does not overwrite model adapter
```

### Task 8: Connect OpenHub Contract Assistance Without Publishing Models Automatically

**Files:**
- Create: `packages/server/src/engine/catalog/memefast-resolver.ts`
- Modify: `packages/server/src/routes/router.ts`
- Modify: `packages/server/src/engine/param-mapper.ts`
- Modify: `packages/server/src/lib/model-contract.ts`
- Modify: `packages/server/test-param-mapper.ts`
- Modify: `packages/server/test-model-contract.ts`

**Interfaces:**

Add a server resolver that adapts an OpenHub model row to the shared contract type:

```ts
export function resolveOpenHubMemeFastContract(
  model: ModelRow,
): Promise<CatalogResolution | null>;
```

- [ ] **Step 1: Preserve evidence boundaries**

Only `schemaMatchStatus="confirmed"` may populate the runtime contract used for required fields, enums, and limits. `candidate` and `unmatched` records remain visible as suggestions only.

- [ ] **Step 2: Make unknown parameters observable**

Change the MemeFast execution path so the mapper returns a structured `dropped`/`unknown` list and the route converts it to `unknown_parameter` instead of silently succeeding. Existing legacy adapters may retain their current allow-list behavior until explicitly migrated; do not change unrelated provider behavior in this task.

- [ ] **Step 3: Apply only safe assistance**

Use catalog defaults only when the field is optional, scalar, has an exact/unambiguous model match, and no runtime evidence contradicts it. Do not synthesize missing required values. Return evidence in validation errors and model-profile responses.

- [ ] **Step 4: Add tests**

Cover confirmed Schema enforcement, candidate Schema non-enforcement, invalid enum rejection, unknown field reporting, explicit provider options, and preservation of model-specific fields through field mapping.

### Task 9: Add the Admin UI Entry Point and Integration Documentation

**Files:**
- Modify: `packages/web/src/pages/Sites.tsx`
- Create: `packages/memefast/README.md`
- Modify: `packages/server/src/routes/admin/sites.ts` if adapter listing is needed

- [ ] **Step 1: Add the MemeFast adapter choice**

Add a select option with value `memefast` and label `MemeFast 专用连接器`. Do not expose the API key after save. Keep the existing site form fields: name, base URL, API key, and adapter.

- [ ] **Step 2: Explain the two supported integration modes**

Document only these modes:

```ts
// Third-party backend integration
const client = createMemeFastConnector({
  baseUrl: process.env.MEMEFAST_BASE_URL!,
  apiKey: process.env.MEMEFAST_API_KEY!,
  catalog: loadBundledCatalog(),
});

await client.verify();
const models = await client.discover();
const response = await client.chat({
  model: models[0].id,
  messages: [{ role: "user", content: "hello" }],
});
```

```text
OpenHub hosted mode:
admin saves MemeFast site
  -> OpenHub discovers models
  -> administrator selects/creates a variant
  -> downstream application uses OpenHub's virtual API key and /v1 endpoints
```

State explicitly that the connector is backend-only and that users must not send MemeFast keys from a browser.

- [ ] **Step 3: Document the support boundary**

List P0 operations, strict parameter behavior, catalog confidence, current video/native deferral, URL requirements, and the requirement to use a non-production key for smoke tests.

### Task 10: Run Full P0 Verification

**Files:**
- Modify: `packages/server/package.json` to include `test-memefast-adapter.ts`.
- Modify: `packages/server/test-memefast-adapter.ts` to include the final regression assertions.

- [ ] **Step 1: Run focused package checks**

```powershell
pnpm --filter @openhub/memefast test
pnpm --filter @openhub/memefast typecheck
pnpm --filter @openhub/server test
pnpm --filter @openhub/server typecheck
```

- [ ] **Step 2: Run workspace checks**

```powershell
pnpm -r typecheck
pnpm -r test
```

Do not fix unrelated pre-existing web build errors during this task. Record them separately if they still occur.

- [ ] **Step 3: Run a live non-production smoke test when credentials are available**

Use environment variables only:

```powershell
$env:MEMEFAST_TEST_BASE_URL = "https://..."
$env:MEMEFAST_TEST_API_KEY = "..."
pnpm --filter @openhub/memefast exec tsx scripts/smoke-memefast.ts
```

The smoke test must report only endpoint, status, model count, operation name, and normalized error code. It must never print the key or full request body. If a modality is unavailable for the key, record `capability_unavailable`; do not treat that as a connector failure.

- [ ] **Step 4: Verify the hosted browser flow**

Run the local server and web app, open the Sites page, select `MemeFast 专用连接器`, save a test connection, rediscover models, inspect the adapter column, and make one Chat request through a manually created variant. Confirm the browser console contains no API key and the request reaches the `memefast` adapter.

---

## 4. P1 Plan: Async Video and Selected Native Operations

Do not begin this phase until every P0 check passes and the exact MemeFast contract is captured.

### P1-A: Async Video

Reuse the existing OpenHub task tables and worker instead of creating a second task system.

Files:

- Modify: `packages/memefast/src/types.ts` — add `submitVideo`, `queryVideo`, and `waitForVideo` types.
- Modify: `packages/memefast/src/client.ts` — implement only the confirmed MemeFast queue lifecycle.
- Modify: `packages/server/src/engine/adapters/memefast.ts` — map the core task handle to existing `submitVideoTask` and `queryVideoTask` methods.
- Modify: `packages/server/src/engine/tasks/worker.ts` only if the confirmed status/result mapping requires a narrow change.
- Create: `packages/memefast/test-video.ts` — mock pending, processing, completed, failed, and timeout states.

Required invariants:

- POST submission is not retried without a confirmed idempotency contract.
- Polling and callback delivery are retryable and idempotent.
- Raw prompts and media URLs remain redacted in task listing responses.
- A missing video contract keeps the capability unavailable rather than guessing an endpoint.

### P1-B: Static Native Operation Manifests

If high-value native endpoints are needed, add compiled descriptors only for confirmed operations:

```ts
interface NativeOperationManifest {
  id: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  requestContract: InputContract;
  responseKind: "json" | "binary" | "stream";
}
```

The manifest list is compiled into the package. Callers cannot supply arbitrary paths. Each manifest requires a mock test and a live smoke test before release.

---

## 5. P2 Deferrals

- Add tenant-scoped `connections` only if a product requirement says each end user enters and owns a different MemeFast key. The current `sites` table is appropriate for deployment-level configuration, not end-user credentials.
- Add Python or Go SDKs only after the TypeScript core API is stable and used by at least one real integration.
- Add catalog release automation only after snapshot size, update frequency, and backward compatibility are measured.
- Add a generic adapter framework only after at least two genuinely different site protocols require the same discovery/contract abstraction. MemeFast alone does not justify it.

---

## 6. Final Release Criteria

Release P0 only if all statements are true:

- A backend can configure MemeFast with only `baseUrl` and `apiKey`.
- `/v1/models` discovery works with or without a trailing `/v1` in the configured URL.
- A MemeFast site-sourced model is routed through `memefast`, not the legacy OpenAI adapter.
- Manual model adapter overrides survive later site rediscovery.
- Chat, stream, embedding, image generation, and audio operations have verified request paths and response validation.
- Missing and invalid parameters fail before an upstream call when the contract is known.
- Candidate catalog data never silently becomes a runtime provider contract.
- Unknown parameters are reported rather than silently discarded.
- No API key appears in logs, errors, frontend code, or response payloads.
- Package tests, server tests, and typechecks pass; unrelated existing failures are separately recorded.

**Result:** After this plan, OpenHub is a focused MemeFast integration product: configure one backend connection, discover usable models, receive honest parameter assistance, and call stable standard endpoints. It is not a brittle copy of MemeFast or a speculative universal adapter.
