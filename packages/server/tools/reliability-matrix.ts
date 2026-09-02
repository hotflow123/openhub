import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { desc, eq } from "drizzle-orm";
import { db } from "../src/db/index.js";
import { modelCapabilityProbes, models, sites } from "../src/db/schema/index.js";
import { isProbeForCurrentConfig } from "../src/engine/capability/status.js";
import { modelEvidenceState } from "../src/lib/model-contract.js";

type CountMap = Record<string, number>;
const count = (rows: string[]): CountMap => rows.reduce<CountMap>((out, key) => {
  out[key] = (out[key] ?? 0) + 1;
  return out;
}, {});

const runtimeCapabilityForModality = (modality: string): string | null => modality === "llm"
  ? "chat"
  : modality === "image"
    ? "image.generation"
    : modality === "audio"
      ? "audio.speech"
      : modality === "video"
        ? "video.submit"
        : modality === "embedding"
          ? "embedding"
          : null;

const rows = await db.select().from(models);
const probes = await db
  .select({
    modelId: modelCapabilityProbes.modelId,
    capability: modelCapabilityProbes.capability,
    status: modelCapabilityProbes.status,
    configRevision: modelCapabilityProbes.configRevision,
    siteRevision: sites.configRevision,
    checkedAt: modelCapabilityProbes.checkedAt,
  })
  .from(modelCapabilityProbes)
  .leftJoin(models, eq(modelCapabilityProbes.modelId, models.id))
  .leftJoin(sites, eq(models.siteId, sites.id))
  .orderBy(desc(modelCapabilityProbes.checkedAt));
const latestProbe = new Map<string, typeof probes[number]>();
for (const probe of probes) {
  if (!isProbeForCurrentConfig(probe.configRevision, probe.siteRevision)) continue;
  if (!latestProbe.has(`${probe.modelId}:${probe.capability}`)) latestProbe.set(`${probe.modelId}:${probe.capability}`, probe);
}
const evidence = rows.map((row) => ({
  id: row.id,
  rawName: row.rawName,
  vendor: row.vendor ?? "unknown",
  modality: row.modality,
  adapter: row.adapterId ?? "unknown",
  identity: modelEvidenceState(row, (() => {
    const capability = runtimeCapabilityForModality(row.modality);
    const probe = capability ? latestProbe.get(`${row.id}:${capability}`) : undefined;
    return probe ? { status: probe.status, capability: probe.capability, requiredCapability: capability } : null;
  })()).identityStatus,
  contract: modelEvidenceState(row, (() => {
    const capability = runtimeCapabilityForModality(row.modality);
    const probe = capability ? latestProbe.get(`${row.id}:${capability}`) : undefined;
    return probe ? { status: probe.status, capability: probe.capability, requiredCapability: capability } : null;
  })()).contractStatus,
  parameters: modelEvidenceState(row, (() => {
    const capability = runtimeCapabilityForModality(row.modality);
    const probe = capability ? latestProbe.get(`${row.id}:${capability}`) : undefined;
    return probe ? { status: probe.status, capability: probe.capability, requiredCapability: capability } : null;
  })()).parameterCoverage,
  runtime: modelEvidenceState(row, (() => {
    const capability = runtimeCapabilityForModality(row.modality);
    const probe = capability ? latestProbe.get(`${row.id}:${capability}`) : undefined;
    return probe ? { status: probe.status, capability: probe.capability, requiredCapability: capability } : null;
  })()).executionStatus,
}));
const ids = (predicate: (row: typeof evidence[number]) => boolean) => evidence.filter(predicate).map((row) => row.id);
const matrix = {
  generatedAt: new Date().toISOString(),
  total: evidence.length,
  byVendor: count(evidence.map((row) => row.vendor)),
  byModality: count(evidence.map((row) => row.modality)),
  byAdapter: count(evidence.map((row) => row.adapter)),
  byIdentity: count(evidence.map((row) => row.identity)),
  byContract: count(evidence.map((row) => row.contract)),
  byParameters: count(evidence.map((row) => row.parameters)),
  byRuntime: count(evidence.map((row) => row.runtime)),
  buckets: {
    executable: ids((row) => row.runtime === "ready"),
    identityOnly: ids((row) => row.identity === "recognized" && row.contract !== "confirmed"),
    schemaCandidates: rows.filter((row) => row.schemaMatchStatus === "candidate").map((row) => row.id),
    incompleteParameters: ids((row) => row.parameters !== "complete"),
    protocolUnverified: rows.filter((row) => row.modality === "video" && row.videoContractStatus !== "confirmed").map((row) => row.id),
    recentFailures: rows.filter((row) => row.status !== "active").map((row) => row.id),
    unknownModels: ids((row) => row.modality === "unknown" || row.identity === "unmatched"),
  },
  combinations: count(evidence.map((row) => `${row.vendor}|${row.modality}|${row.adapter}|${row.contract}|${row.parameters}|${row.runtime}`)),
};

const output = resolve(process.cwd(), "../../docs/reliability-matrix-20260831.json");
mkdirSync(resolve(process.cwd(), "../../docs"), { recursive: true });
writeFileSync(output, `${JSON.stringify(matrix, null, 2)}\n`, "utf8");
console.log(`[openhub] reliability matrix written: ${output}`);
