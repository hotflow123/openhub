# MemeFast Protocol Inventory

Inventory date: 2026-09-05

## Source status

| Source | Kind | Status | Coverage |
|---|---|---|---|
| `https://docs.memefast.cc/` | Primary documentation | Synchronized 2026-09-05 | 48 distinct protocol groups / 96 immutable records |
| `https://memefast.apifox.cn` | Documentation mirror candidate | Fetch failed | Disabled; no protocol contract imported |
| `https://api.memefast.cc/v1` | Runtime API | Verified 2026-09-05 | HTTP 200; 459 models |
| `EXECUTION-PLAN-MEMEFAST-MASTER.md` | Local planning document | Planning only | Not protocol evidence |

The HTTPS documentation fetch was not reliable during this inventory. No
MemeFast-specific operation is marked confirmed or enabled from that failure.
The repository therefore does not claim a complete protocol list.

## Confirmed protocols

The official SPA bundle was fetched and parsed on September 5, 2026. It
provided 48 distinct protocol groups, including provider-specific image,
audio, and video routes plus generic OpenAI-compatible routes. Protocol rows
remain immutable; the 96 database records include historical source revisions.

The documentation evidence proves request and response contracts where detail
records exist. Three source fragments remain unparsed: one directory operation
has no provider identity and two orphan detail records have no directory entry.
They are not guessed into executable protocols.

## Synchronization entry points

- `POST /admin/memefast/protocols/import` imports an explicit JSON manifest.
- `POST /admin/memefast/protocols/sync?source=memefast-docs` fetches only an
  enabled allow-listed source. An HTML directory is scanned only for explicit
  `Reference` links that remain on that source origin/path; those pages are
  scanned only for `application/json` script blocks or fenced JSON. For the
  official SPA root, same-origin module script assets are also fetched from
  explicit `script[type="module"][src]` tags.
- `GET /admin/memefast/protocol-sources` reports source and failure status.
- `GET /admin/memefast/protocols` queries every immutable protocol record.
- `GET /admin/memefast/protocol-bindings` queries model bindings.

Failed syncs are written to `protocol_sync_runs` and do not insert or delete
protocol records or model bindings.

Sync responses report `added`, `changed`, `unparsed`, and `failed`. A malformed
or undocumented Reference page is `unparsed`; fetch or import errors are
`failed`. Existing protocol records remain untouched in both cases.

## Official SPA bundle coverage

The official root is a SPA, so the synchronizer does not treat rendered HTML as
the protocol source. It reads only same-origin, allow-listed module assets and
extracts `JSON.parse` string literals without evaluating JavaScript:

- `JT` is treated as the explicit directory tree.
- `RN` is treated as the explicit detail table keyed by `apifoxApiId`.
- Directory operations are associated with `RN` details by exact
  `apifoxApiId`.
- Imported groups use stable internal IDs such as `memefast.seedance`; model
  names are not rewritten.
- Version is `source-<sha256-prefix>` derived from the fetched root/assets.
- `requestBody`, `responses`, `requestExamples`, `deprecated`, and directory
  metadata are retained when explicitly present.
- Missing associations, malformed literals, and unknown operation shapes are
  reported as `unparsed`; no fields or endpoints are inferred.

The September 5, 2026 live check returned HTTP 200 and 459 models. The
MemeFast site currently has 459 local model records and 459 protocol bindings.
The latest binding audit found no unbound MemeFast model. Two Wan models now
bind to the documented Alibaba Bailian video contract instead of Kling.
Historical non-MemeFast records may still exist under other sites.

## Execution wiring

The implementation now closes the first runtime loop without changing a
downstream model name:

- Explicit `model` enum values and request examples are extracted into each
  protocol document as `modelNames`.
- Newly discovered models are matched to the newest protocol by exact or
  separator-normalized name; no model-name guessing is used.
- A model with no protocol binding is not executable through the `memefast`
  adapter.
- The `memefast` adapter reads the bound protocol operation paths and performs
  standard chat, image, audio, and video requests; video task IDs and statuses
  are normalized for the existing task worker.
- Confirmed Fal/Open-Generative-AI schemas remain parameter assistance only;
  MemeFast protocol records decide the actual endpoint and request contract.

This is not a claim that the live source was successfully refreshed on
September 5, 2026. A successful synchronization is still required before
new or changed official protocols can be bound.

## Imported manifest shape

```json
{
  "protocolId": "memefast.example",
  "version": "1.0.0",
  "name": "Example",
  "sourceUrl": "https://...",
  "operations": [
    {
      "operationId": "models.list",
      "method": "GET",
      "path": "/v1/models"
    }
  ],
  "requestContract": {},
  "responseContract": {},
  "statusMapping": {},
  "parameterMapping": {}
}
```

An imported record remains disabled until fixture or runtime evidence is
available.
