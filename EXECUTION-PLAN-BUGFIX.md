# OpenHub Bug Fix Execution Plan

> Based on code review at commit 6ad1df5 with independent verification.

---

## 0. Independent Analysis: Premise Validation

### Confirmed Facts (line-by-line code verification)

| # | Finding | Verification |
|---|---------|-------------|
| F1 | `/v1/models` has no auth middleware | Full read of `routes/v1/models.ts` — zero references to `authMiddleware` |
| F2 | `checkRateLimit(record.id, null)` always passes null | `middleware/auth.ts` line 83 |
| F3 | `keys` table has no `rate_limit` column | Full read of `db/schema/keys.ts` |
| F4 | `verifyToken()` exported but never imported anywhere | Recursive search only hits definition + export lines in users.ts |
| F5 | Web frontend embeds Basic Auth credentials via Vite env vars | `web/src/lib/api.ts` lines 15-17; `web/src/App.tsx` AuditTable function |
| F6 | Adapter forward methods have no timeout or redirect protection | All `AbortSignal.timeout(5000)` calls appear only in `healthCheck()` methods across all 5 adapters; `safeFetch` from ssrf.ts is never imported by any adapter |
| F7 | CORS configured as `origin: "*"` | `src/index.ts` |
| F8 | Password hashing uses SHA-256 + salt (not bcrypt/argon2) | `users.ts hashPassword()` uses `createHash("sha256")` |

### Reasonable Inferences

| # | Inference | Basis |
|---|-----------|-------|
| I1 | Project is in development phase, not deployed to production | Extensive test scripts, no CI/CD config, DESIGN.md iterative planning |
| I2 | JWT system is Phase 3 planned but not wired into routes | users.ts comments "Phase 3"; no middleware consumes JWT; `_with-auth.ts` only imports Basic Auth |
| I3 | Frontend credential embedding is dev convenience | Default values match backend (`admin:admin123`) |

### Corrections to Original Analysis

| Original Assessment | Corrected | Reason |
|--------------------|-----------|--------|
| JWT no expiry = P0 vulnerability | P2 design debt | JWT completely unwired (F4); no active attack surface |
| Video param mapping inconsistency = P1 bug | P3 dead code | Actual submission goes through worker which correctly maps params |

### Unverified Assumptions (require confirmation before implementation)

| # | Question | Impact |
|---|----------|--------|
| U1 | Deployed to public server? | Urgency of Phase A vs B |
| U2 | Rate limiting strategy? Per-key or global? | DB schema approach for A-2 |
| U3 | JWT to replace Basic Auth? | C-1 implement vs delete |
| U4 | Existing CI/CD pipeline? | Regression testing approach |

---

## 1. Execution Plan

### Phase A: Critical Fixes (deployment blockers)

#### A-1. Add authentication to /v1/models

Files: `packages/server/src/routes/v1/models.ts`

Add authMiddleware import and use.

Risk: Low.
Verify: No key returns 401; valid key returns model list.

#### A-2. Implement basic rate limiting

Prerequisite: Answer U2. Default: global 60 req/min per key.

1. `db/schema/keys.ts` add `rateLimit integer nullable`
2. `middleware/auth.ts` line 83 change `null` to `record.rateLimit ?? 60`
3. New migration file

Risk: Medium (migration + restart).
Verify: >limit requests return 429.

#### A-3. Add timeouts to adapter forward methods

Files: all `engine/adapters/*.ts` forward methods

Add `signal: AbortSignal.timeout(30_000)` to every fetch() call.
Exception: forwardChatStream (SSE long-lived).

Risk: Very low.
Verify: Mock upstream 35s delay returns timeout error.

### Phase B: Security Hardening

#### B-1. Restrict CORS origins

File: `packages/server/src/index.ts`

Change origin "*" to env-configured whitelist defaulting to localhost:5173.

Risk: Low.
Verify: Non-whitelisted origin rejected.

#### B-2. Remove hardcoded frontend credentials

Short-term: Vite dev proxy injects auth server-side.
Long-term: JWT login flow (depends on C-1).

Files: vite.config.ts, api.ts, App.tsx AuditTable.

Risk: Medium (touches all admin pages).
Verify: Admin pages load data after change.

#### B-3. Remove dead code in router.ts

Delete unused submitVideoTask() and queryVideoTask() exports.

Pre-check: confirm no other files import these functions.

### Phase C: Design Completion (deferrable)

#### C-1. JWT system: implement or remove

Option A (recommended): Wire JWT middleware into admin routes
Option B: Delete unused signToken/verifyToken/publicLogin

Prerequisite: Answer U3.
If implementing: add exp check, replace SHA-256 hashing with scrypt.

#### C-2. Batch optimize discoverModels

Batch SELECT + in-memory dedup + batch INSERT (chunks of 100).
Benefit: hundreds of models go from minutes to seconds.

#### C-3. Password hashing upgrade

Handle with C-1: SHA-256 to crypto.scryptSync().

---

## 2. Verification Checklist

| Item | Method | Pass Criteria |
|------|--------|--------------|
| /v1/models auth | curl without key; with key | 401; 200 |
| Rate limit | Loop 70 requests | #61 returns 429 |
| Adapter timeout | Mock 35s delay | Error at ~30s |
| CORS | Origin: evil.com | No ACAO header |
| Frontend login | Browser /admin/sites | Login then data loads |
| Existing tests | pnpm test | All pass |

## 3. Execution Order

A-3 and A-1: parallel, no dependency
A-2: separate PR (migration)
B-1, B-3: parallel, no dependency
B-2: last (touches all admin pages)
C-*: blocked on U3/U4 answers

## 4. Explicit Non-Goals

- Redis distributed rate limiting: single-instance sufficient
- argon2: user system incomplete, bundle with C-1
- variant_groups routing: business requirements undefined
- Full discoverModels rewrite: batch optimization sufficient