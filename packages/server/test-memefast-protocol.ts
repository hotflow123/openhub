import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMemeFastProtocolDocuments,
  extractMemeFastJsonBlocks,
  extractMemeFastJsonParseBindings,
  extractMemeFastModuleScriptUrls,
  extractMemeFastReferenceLinks,
  extractProtocolModelNames,
  importProtocolDocument,
  syncProtocolSource,
  type ProtocolStore,
} from "./src/engine/memefast-protocol-sync";
import { inferModelCapability } from "./src/engine/infer";
import { inferModelCapability as inferLegacyModelCapability } from "./src/engine/llm-infer";
import { inferRuntimeModality, resolveEffectiveRuntimeModel } from "./src/engine/discover";
import { mapStoredVariantParams } from "./src/engine/param-mapper";
import {
  assessProtocolReadiness,
  chooseProtocolCandidate,
  isExecutableVideoProtocol,
} from "./src/engine/protocol-catalog";

function store() {
  const protocols: Array<Record<string, any>> = [];
  const runs: Array<Record<string, any>> = [];
  const db: ProtocolStore = {
    async findByIdentity(protocolId, version) {
      return protocols.filter((row) => row.protocolId === protocolId && row.version === version) as any;
    },
    async insertProtocol(row) {
      protocols.push(row);
    },
    async insertRun(row) {
      runs.push(row);
    },
  };
  return { db, protocols, runs };
}

function jsJson(value: unknown): string {
  return JSON.stringify(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

const document = {
  protocolId: "memefast.demo",
  version: "1.0.0",
  operations: [{ operationId: "models.list", method: "GET", path: "/v1/models" }],
  requestContract: { fields: ["prompt", "duration"] },
};

test("imports a protocol and keeps old content when the same version changes", async () => {
  const fixture = store();
  const first = await importProtocolDocument(document, fixture.db, { sourceUrl: "fixture://demo" });
  const secondVersion = await importProtocolDocument({ ...document, version: "2.0.0" }, fixture.db, { sourceUrl: "fixture://demo" });
  const changed = await importProtocolDocument({ ...document, requestContract: { fields: ["prompt", "duration", "resolution"] } }, fixture.db, { sourceUrl: "fixture://demo" });
  assert.equal(first.diff?.status, "added");
  assert.equal(secondVersion.diff?.status, "added");
  assert.equal(changed.diff?.status, "changed");
  assert.equal(fixture.protocols.length, 3);
  assert.equal(fixture.protocols[0].enabled, false);
  assert.equal(fixture.protocols[2].previousHash, fixture.protocols[0].contentHash);
});

test("same protocol content remains idempotent when an older revision is returned later", async () => {
  const protocols: Array<Record<string, any>> = [];
  const fixture: ProtocolStore = {
    async findByIdentity(protocolId, version) {
      return protocols
        .filter((row) => row.protocolId === protocolId && row.version === version)
        .reverse() as any;
    },
    async insertProtocol(row) {
      protocols.push(row);
    },
    async insertRun() {},
  };
  await importProtocolDocument(document, fixture, { sourceUrl: "fixture://demo" });
  await importProtocolDocument(
    { ...document, requestContract: { fields: ["prompt", "duration", "resolution"] } },
    fixture,
    { sourceUrl: "fixture://demo" },
  );
  const result = await importProtocolDocument(document, fixture, { sourceUrl: "fixture://demo" });
  assert.equal(result.diff?.status, "unchanged");
  assert.equal(protocols.length, 2);
});

test("failed import records failure and preserves the previous protocol", async () => {
  const fixture = store();
  await importProtocolDocument(document, fixture.db, { sourceUrl: "fixture://demo" });
  const result = await importProtocolDocument({ ...document, operations: "invalid" }, fixture.db, { sourceUrl: "fixture://demo" });
  assert.equal(result.status, "failed");
  assert.equal(fixture.protocols.length, 1);
  assert.equal(fixture.runs.at(-1)?.status, "failed");
});

test("failed source sync records the network error and preserves old data", async () => {
  const fixture = store();
  await importProtocolDocument(document, fixture.db, { sourceUrl: "fixture://demo" });
  const result = await syncProtocolSource("memefast-docs", fixture.db, async () => {
    throw new Error("TLS unavailable");
  });
  assert.equal(result.status, "failed");
  assert.match(result.errorMessage ?? "", /TLS unavailable/);
  assert.equal(fixture.protocols.length, 1);
});

test("HTML directories expose only allow-listed Reference links", () => {
  const html = `
    <a href="/reference/video">Video Reference</a>
    <a href="reference/image">Image Reference</a>
    <a href="https://evil.example/reference">Reference</a>
    <a href="https://docs.memefast.cc/other">Other</a>
  `;
  assert.deepEqual(
    extractMemeFastReferenceLinks(html, "https://docs.memefast.cc/"),
    [
      "https://docs.memefast.cc/reference/video",
      "https://docs.memefast.cc/reference/image",
    ],
  );
});

test("HTML Reference pages import explicit JSON manifests and report aggregates", async () => {
  const fixture = store();
  const manifest = {
    protocolId: "memefast.html",
    version: "1.0.0",
    operations: [{ operationId: "video.generate", method: "POST", path: "/v1/video" }],
  };
  const pages = new Map([
    ["https://docs.memefast.cc/", new Response(`
      <a href="/reference/video">Video Reference</a>
      <a href="https://external.example/reference">External Reference</a>
    `, { headers: { "content-type": "text/html" } })],
    ["https://docs.memefast.cc/reference/video", new Response(`
      <script type="application/json">${JSON.stringify(manifest)}</script>
    `, { headers: { "content-type": "text/html" } })],
  ]);
  const result = await syncProtocolSource("memefast-docs", fixture.db, async (input) => {
    const page = pages.get(String(input));
    if (!page) throw new Error(`unexpected fetch: ${String(input)}`);
    return page;
  });
  assert.equal(result.status, "success");
  assert.deepEqual(
    { added: result.added, changed: result.changed, unparsed: result.unparsed, failed: result.failed },
    { added: 1, changed: 0, unparsed: 0, failed: 0 },
  );
  assert.equal(fixture.protocols[0].protocolId, "memefast.html");
  assert.deepEqual(
    extractMemeFastJsonBlocks("<script type=\"application/json\">not-json</script>"),
    [undefined],
  );
});

test("official module bundles join JT operations with RN details and retain schemas", async () => {
  const fixture = store();
  const directory = [
    {
      apifoxApiId: "seedance-create",
      platform: "seedance",
      path: "/v1/video/generations",
      method: "POST",
      summary: "Create video",
    },
    {
      apifoxApiId: "seedance-query",
      platform: "seedance",
      path: "/v1/video/generations/{id}",
      method: "GET",
      summary: "Query video",
    },
  ];
  const details = {
    "seedance-create": {
      requestBody: {
        schema: {
          properties: {
            model: { enum: ["seedance2.0"] },
            duration: { type: "integer" },
            ratio: { type: "string" },
            resolution: { type: "string" },
            content: { type: "array" },
          },
        },
      },
      responses: { "200": { schema: { properties: { id: { type: "string" } } } } },
      requestExamples: [{ name: "create", request: { model: "seedance2.0", duration: 5, ratio: "16:9", resolution: "1080p", content: [] } }],
      deprecated: false,
    },
    "seedance-query": {
      requestBody: { schema: { properties: { id: { type: "string" } } } },
      responses: { "200": { schema: { properties: { status: { type: "string" } } } } },
      requestExamples: [{ name: "query", request: { id: "task-1" } }],
      deprecated: false,
    },
  };
  const bundle = `const JT=JSON.parse('${jsJson(directory)}');const RN=JSON.parse('${jsJson(details)}');`;
  const root = new Response(`
    <script type="module" src="/assets/memefast.js"></script>
    <script type="module" src="https://evil.example/asset.js"></script>
  `, { headers: { "content-type": "text/html" } });
  const asset = new Response(bundle, { headers: { "content-type": "application/javascript" } });
  const pages = new Map([
    ["https://docs.memefast.cc/", root],
    ["https://docs.memefast.cc/assets/memefast.js", asset],
  ]);
  const fetcher = async (input: RequestInfo | URL) => {
    const page = pages.get(String(input));
    if (!page) throw new Error(`unexpected fetch: ${String(input)}`);
    return page.clone();
  };
  assert.deepEqual(
    extractMemeFastModuleScriptUrls(await root.clone().text(), "https://docs.memefast.cc/"),
    ["https://docs.memefast.cc/assets/memefast.js"],
  );
  assert.equal(extractMemeFastJsonParseBindings(bundle).unparsed, 0);
  const result = await syncProtocolSource("memefast-docs", fixture.db, fetcher);
  assert.equal(result.added, 1);
  assert.equal(result.unparsed, 0);
  assert.equal(fixture.protocols[0].protocolId, "memefast.seedance.video");
  assert.equal(fixture.protocols[0].modality, "video");
  const operations = JSON.parse(fixture.protocols[0].operations);
  assert.deepEqual(operations.map((operation: any) => operation.path), [
    "/v1/video/generations",
    "/v1/video/generations/{id}",
  ]);
  assert.equal(operations[0].requestBody.schema.properties.duration.type, "integer");
  assert.equal(operations[0].requestBody.schema.properties.ratio.type, "string");
  assert.equal(operations[0].requestBody.schema.properties.resolution.type, "string");
  assert.equal(operations[0].requestBody.schema.properties.content.type, "array");
  assert.deepEqual(JSON.parse(fixture.protocols[0].rawDocument).modelNames, ["seedance2.0"]);
  assert.equal(operations[0].requestExamples[0].request.duration, 5);
  assert.equal(operations[0].deprecated, false);

  const changedBundle = bundle.replace("Create video", "Create video v2");
  pages.set("https://docs.memefast.cc/assets/memefast.js", new Response(changedBundle, {
    headers: { "content-type": "application/javascript" },
  }));
  const changed = await syncProtocolSource("memefast-docs", fixture.db, fetcher);
  assert.equal(changed.added, 1);
  assert.equal(fixture.protocols.length, 2);
  assert.notEqual(fixture.protocols[0].version, fixture.protocols[1].version);
  assert.equal(JSON.parse(fixture.protocols[0].operations)[0].summary, "Create video");
  assert.equal(JSON.parse(fixture.protocols[1].operations)[0].summary, "Create video v2");
});

test("bundle builder reports orphan RN details without guessing a protocol", () => {
  const result = buildMemeFastProtocolDocuments(
    [
      `const JT=JSON.parse('${jsJson([{
        apifoxApiId: "known",
        platform: "seedance",
        path: "/v1/video/generations",
        method: "POST",
      }])}');const RN=JSON.parse('${jsJson({
        known: { requestBody: {}, responses: {} },
        orphan: { requestBody: {}, responses: {} },
      })}');`,
    ],
    "https://docs.memefast.cc/",
    ["https://docs.memefast.cc/", "https://docs.memefast.cc/assets/memefast.js"],
    "0123456789abcdef0123456789abcdef",
  );
  assert.equal(result.documents.length, 1);
  assert.equal(result.unparsed, 1);
});

test("directory operations remain available when the detail record is absent", () => {
  const result = buildMemeFastProtocolDocuments(
    [
      `const JT=JSON.parse('${jsJson([{
        apifoxApiId: "query-only",
        platform: "seedance",
        path: "/api/v3/contents/generations/tasks/{task_id}",
        method: "GET",
        summary: "任务查询",
      }])}');const RN=JSON.parse('${jsJson({})}');`,
    ],
    "https://docs.memefast.cc/",
    ["https://docs.memefast.cc/"],
    "fedcba9876543210fedcba9876543210",
  );
  assert.equal(result.documents.length, 1);
  assert.equal(result.unparsed, 0);
  assert.equal((result.documents[0].operations[0] as any).path, "/api/v3/contents/generations/tasks/{task_id}");
});

test("unparsed Reference pages do not replace existing protocol records", async () => {
  const fixture = store();
  await importProtocolDocument(document, fixture.db, { sourceUrl: "fixture://demo" });
  const pages = new Map([
    ["https://docs.memefast.cc/", new Response(
      '<a href="/reference/broken">Broken Reference</a>',
      { headers: { "content-type": "text/html" } },
    )],
    ["https://docs.memefast.cc/reference/broken", new Response(
      "<html><body>Protocol fields are described elsewhere.</body></html>",
      { headers: { "content-type": "text/html" } },
    )],
  ]);
  const result = await syncProtocolSource("memefast-docs", fixture.db, async (input) => {
    const page = pages.get(String(input));
    if (!page) throw new Error(`unexpected fetch: ${String(input)}`);
    return page;
  });
  assert.equal(result.status, "partial");
  assert.equal(result.unparsed, 1);
  assert.equal(result.failed, 0);
  assert.equal(fixture.protocols.length, 1);
});

test("media parameters remain visible without a models-list contract", () => {
  const result = mapStoredVariantParams({
    model: "seedance2.0",
    ratio: "16:9",
    resolution: "1080p",
    duration: 10,
    reference_image_urls: ["https://example.test/a.png"],
  }, {}, ["model", "prompt"]);
  assert.deepEqual(result.body, {
    model: "seedance2.0",
    ratio: "16:9",
    resolution: "1080p",
    duration: 10,
    reference_image_urls: ["https://example.test/a.png"],
  });
  assert.deepEqual(result.dropped, []);
});

test("runtime metadata identifies modality without relying on model-name guesses", () => {
  assert.equal(inferRuntimeModality({
    id: "gpt-5.5-pro-2026-04-23",
    model_type: "对话",
    supported_endpoint_types: ["openai"],
    tags: "对话,工具",
  }), "llm");
  assert.equal(inferRuntimeModality({
    id: "seedance",
    model_type: "音视频",
    supported_endpoint_types: ["Doubao video (Async)"],
    tags: "异步,视频",
  }), "video");
  assert.equal(inferRuntimeModality({
    id: "embedding",
    model_type: "检索",
    supported_endpoint_types: ["Embedding"],
  }), "embedding");
});

test("inference never invents an LLM for an unknown model", async () => {
  const result = await inferModelCapability("private-provider-model-xyz");
  assert.equal(result.modality, "unknown");
  assert.equal(result.confidence, 0);
  assert.equal(result.llm, undefined);

  const legacyResult = await inferLegacyModelCapability("private-provider-model-xyz");
  assert.equal(legacyResult.modality, "unknown");
  assert.equal(legacyResult.confidence, 0);
});

test("name rules identify a known family without inventing parameter limits", async () => {
  const llm = await inferModelCapability("gpt-5.5-pro-2026-04-23");
  assert.equal(llm.modality, "llm");
  assert.equal(llm.inferredVendor, "OpenAI");
  assert.deepEqual(llm.llm, {});

  const video = await inferModelCapability("seedance2.0");
  assert.equal(video.modality, "video");
  assert.deepEqual(video.video, { requiresAsync: true });
});

test("dated and tiered aliases inherit metadata from their documented base model", () => {
  const effective = resolveEffectiveRuntimeModel(
    { id: "gpt-5.5-pro-2026-04-23", object: "model", supported_endpoint_types: [] },
    [{
      id: "gpt-5.5-pro",
      object: "model",
      model_type: "对话",
      supported_endpoint_types: ["openai-response"],
    }],
  );
  assert.equal(effective._openhubMetadataInheritedFrom, "gpt-5.5-pro");
  assert.equal(inferRuntimeModality(effective), "llm");
  assert.deepEqual(effective.supported_endpoint_types, ["openai-response"]);
});

test("protocol model extraction includes documented description choices", () => {
  assert.deepEqual(
    extractProtocolModelNames({
      protocolId: "memefast.pixverse.video",
      version: "1",
      operations: [{
        requestBody: {
          properties: {
            model: {
              type: "string",
              description: '模型 "v4.5", "v5.5", "v5.6"',
            },
          },
        },
      }],
    }),
    ["v4.5", "v5.5", "v5.6"],
  );
});

test("protocol model extraction reads unquoted model examples from provider docs", () => {
  assert.deepEqual(
    extractProtocolModelNames({
      protocolId: "memefast.alibailian.video",
      version: "1",
      operations: [{
        requestBody: {
          properties: {
            model: {
              type: "string",
              description: "模型名称。示例值：wan2.5-i2v-preview。",
            },
          },
        },
        examples: [{
          value: "{\"model\":\"wan2.6-i2v\",\"input\":{\"prompt\":\"test\"}}",
        }],
      }],
    }),
    ["wan2.5-i2v-preview", "wan2.6-i2v"],
  );
});

test("video protocol readiness requires explicit submit and query operations", () => {
  const incomplete = {
    protocolId: "memefast.demo.video",
    version: "1",
    modality: "video" as const,
    operations: [
      { operationRole: "video.submit", method: "POST", path: "/v1/video/generations" },
    ],
  };
  assert.deepEqual(assessProtocolReadiness(incomplete), {
    ready: false,
    missing: ["video.query"],
  });
  assert.equal(isExecutableVideoProtocol(incomplete), false);
  assert.equal(
    isExecutableVideoProtocol({
      ...incomplete,
      operations: [
        ...incomplete.operations,
        { operationRole: "video.query", method: "GET", path: "/v1/video/generations/{id}" },
      ],
    }),
    true,
  );
});

function protocolCandidate(
  protocolId: string,
  modality: "llm" | "image" | "audio" | "video" | "embedding",
  modelNames: string[],
  platform: string,
  fetchedAt = new Date("2026-09-05T00:00:00Z"),
) {
  return {
    row: {
      protocolId,
      version: "1",
      fetchedAt,
    },
    document: {
      protocolId,
      version: "1",
      modality,
      modelNames,
      operations: [{ method: "POST", path: `/${platform}/generate`, platform }],
    },
  } as any;
}

function runtimeModel(rawName: string, modality: "video" | "llm", endpointTypes: string[]) {
  return {
    rawName,
    modality,
    sourceMetadata: JSON.stringify({ supported_endpoint_types: endpointTypes }),
  } as any;
}

test("model binding rejects a Wan model when only Kling protocol exists", () => {
  assert.equal(
    chooseProtocolCandidate(
      runtimeModel("wan2.6-i2v", "video", ["Wan video generation"]),
      [protocolCandidate("memefast.kling.video", "video", ["kling-v3"], "kling")],
    ),
    null,
  );
});

test("model binding uses the model family to disambiguate polluted protocol model lists", () => {
  const match = chooseProtocolCandidate(
    runtimeModel("veo_3_1", "video", ["OpenAI video format"]),
    [
      protocolCandidate("memefast.grok.video", "video", ["veo_3_1"], "grok"),
      protocolCandidate("memefast.veo.video", "video", ["veo_3_1"], "veo"),
    ],
  );
  assert.equal(match?.row.protocolId, "memefast.veo.video");
});

test("model binding leaves identical cross-family names ambiguous", () => {
  assert.equal(
    chooseProtocolCandidate(
      runtimeModel("shared-v2", "video", ["OpenAI video format"]),
      [
        protocolCandidate("memefast.sora.video", "video", ["shared-v2"], "sora"),
        protocolCandidate("memefast.grok.video", "video", ["shared-v2"], "grok"),
      ],
    ),
    null,
  );
});

test("model binding falls back to the documented generic protocol by modality", () => {
  const match = chooseProtocolCandidate(
    runtimeModel("o1-preview", "llm", []),
    [{
      row: { protocolId: "memefast.v1.llm", version: "1", fetchedAt: new Date() },
      document: {
        protocolId: "memefast.v1.llm",
        version: "1",
        modality: "llm",
        modelNames: [],
        operations: [{ method: "POST", path: "/v1/chat/completions", platform: "v1" }],
      },
    } as any],
  );
  assert.equal(match?.row.protocolId, "memefast.v1.llm");
  assert.equal(match?.match.reason, "generic_protocol_modality_fallback");
});
