# `@openhub/memefast`

Backend-only MemeFast connector for OpenAI-compatible model operations.

```ts
import { createMemeFastConnector } from "@openhub/memefast";

const client = createMemeFastConnector({
  baseUrl: process.env.MEMEFAST_BASE_URL!,
  apiKey: process.env.MEMEFAST_API_KEY!,
});

await client.verify();
const models = await client.discover();
const response = await client.chat({
  model: models[0].id,
  messages: [{ role: "user", content: "hello" }],
});
```

The connector normalizes a base URL with or without `/v1`, validates the model list and standard operation responses, and never logs or returns the API key. Supported operations are model discovery, Chat, streaming Chat, Embedding, Image Generation, Audio Speech, and Audio Transcription.

Strict mode is the default. Unknown top-level parameters fail with a structured error; provider-specific values must be placed under `provider_options.memefast`. Catalog data can provide suggestions and parameter evidence, but does not override runtime capability evidence.

Use this package from a backend. Do not put MemeFast API keys in browser storage or frontend code.

For a read-only live check, set `MEMEFAST_TEST_BASE_URL` and `MEMEFAST_TEST_API_KEY`, then run `pnpm --filter @openhub/memefast smoke`. Billable Chat testing requires `MEMEFAST_SMOKE_ALLOW_BILLABLE=1` and optionally `MEMEFAST_TEST_CHAT_MODEL`.
