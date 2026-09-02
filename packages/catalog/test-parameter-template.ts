import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { OpenGenerativeAiSnapshot } from "./src/parameter-template.js";

test("Open-Generative-AI snapshot contains the audited source coverage", async () => {
  const snapshot = JSON.parse(await readFile(new URL("./data/open-generative-ai.snapshot.json", import.meta.url), "utf8")) as OpenGenerativeAiSnapshot;
  assert.equal(snapshot.source, "open-generative-ai");
  assert.equal(snapshot.records.length, 439);
  assert.equal(new Set(snapshot.records.flatMap((record) => Object.keys(record.inputs))).size, 128);
  assert.ok(snapshot.sourceCommit);
  assert.match(snapshot.sourceFileSha256, /^[a-f0-9]{64}$/);
  const { generatedAt: _generatedAt, snapshotSha256, ...content } = snapshot;
  const stable = JSON.stringify(content);
  assert.match(snapshotSha256, /^[a-f0-9]{64}$/);
  assert.equal(typeof stable, "string");
  assert.equal(createHash("sha256").update(JSON.stringify({ source: snapshot.source, sourceCommit: snapshot.sourceCommit, sourceFileSha256: snapshot.sourceFileSha256, sourceLicense: snapshot.sourceLicense, records: snapshot.records }, Object.keys({ source: snapshot.source, sourceCommit: snapshot.sourceCommit, sourceFileSha256: snapshot.sourceFileSha256, sourceLicense: snapshot.sourceLicense, records: snapshot.records }).sort())).digest("hex").length, 64);
});
