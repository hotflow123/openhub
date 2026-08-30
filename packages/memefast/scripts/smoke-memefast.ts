import { createMemeFastConnector, MemeFastError } from "../src/index.js";

const baseUrl = process.env.MEMEFAST_TEST_BASE_URL?.trim();
const apiKey = process.env.MEMEFAST_TEST_API_KEY?.trim();

if (!baseUrl || !apiKey) {
  console.error("Missing MEMEFAST_TEST_BASE_URL or MEMEFAST_TEST_API_KEY");
  process.exit(2);
}

const client = createMemeFastConnector({ baseUrl, apiKey });
const verification = await client.verify();

if (!verification.ok) {
  console.error(`verify: error code=${verification.error.code}`);
  process.exit(1);
}

let models;
try {
  models = await client.discover();
} catch (error) {
  const code = error instanceof MemeFastError ? error.info.code : "network_error";
  console.error(`models.list: error code=${code}`);
  process.exit(1);
}
console.log(`verify: ok model_count=${verification.modelCount}`);
console.log(`models.list: ok model_count=${models.length}`);

if (process.env.MEMEFAST_SMOKE_ALLOW_BILLABLE !== "1") process.exit(0);

const model = process.env.MEMEFAST_TEST_CHAT_MODEL?.trim() || models[0]?.id;
if (!model) {
  console.error("chat: skipped reason=no_model");
  process.exit(1);
}

try {
  await client.chat({
    model,
    messages: [{ role: "user", content: "smoke test" }],
  });
  console.log("chat: ok");
} catch (error) {
  const code = error instanceof MemeFastError ? error.info.code : "network_error";
  console.error(`chat: error code=${code}`);
  process.exit(1);
}
