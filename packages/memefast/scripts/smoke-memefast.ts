import { createMemeFastConnector, MemeFastError, type MemeFastVideoProtocol } from "../src/index.js";

const baseUrl = process.env.MEMEFAST_TEST_BASE_URL?.trim();
const apiKey = process.env.MEMEFAST_TEST_API_KEY?.trim();

if (!baseUrl || !apiKey) {
  console.error("Missing MEMEFAST_TEST_BASE_URL or MEMEFAST_TEST_API_KEY");
  process.exit(2);
}

const videoProtocol = process.env.MEMEFAST_TEST_VIDEO_PROTOCOL?.trim();
const client = createMemeFastConnector({
  baseUrl,
  apiKey,
  ...(videoProtocol ? { video: { protocol: videoProtocol as MemeFastVideoProtocol } } : {}),
});
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

const videoModel = process.env.MEMEFAST_TEST_VIDEO_MODEL?.trim();
if (videoModel) {
  if (!videoProtocol) {
    console.error("video: skipped reason=MEMEFAST_TEST_VIDEO_PROTOCOL is required");
    process.exit(1);
  }
  try {
    const submitted = await client.videoSubmit({
      model: videoModel,
      prompt: process.env.MEMEFAST_TEST_VIDEO_PROMPT?.trim() || "smoke test video",
      ...(process.env.MEMEFAST_TEST_VIDEO_DURATION ? { duration: Number(process.env.MEMEFAST_TEST_VIDEO_DURATION) } : {}),
    });
    console.log(`video.submit: ok task_id=${submitted.siteTaskId}`);
    const deadline = Date.now() + 120_000;
    let last = submitted.initialStatus;
    while (Date.now() < deadline) {
      const result = await client.videoQuery(submitted.siteTaskId, videoModel);
      last = result.status;
      console.log(`video.query: status=${result.status}`);
      if (result.status === "completed") {
        if (!result.result?.video_url) throw new Error("completed response missing video_url");
        console.log("video: ok");
        break;
      }
      if (result.status === "failed" || result.status === "timeout") {
        throw new Error(`terminal status=${result.status}${result.error ? `: ${result.error}` : ""}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
    if (!["completed"].includes(last)) throw new Error(`poll timeout; last status=${last}`);
    process.exit(0);
  } catch (error) {
    const code = error instanceof MemeFastError ? error.info.code : "network_error";
    console.error(`video: error code=${code}`);
    process.exit(1);
  }
}

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
