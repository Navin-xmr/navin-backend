# navin-backend — Project TODO

Last updated: 2026-08-25 · branch `main` @ `447f717`

## Contents

| Part | Scope | Sections |
|---|---|---|
| **1** | Test failure remediation — 28 failed suites / 160 failed tests | A–G |
| **2** | Containerization review — Dockerfile / compose / CI gaps | H |
| **3** | Hash-and-Emit chain integration — backend prep for Soroban contracts (interface co-design phase) | I–L |
| **4** | Documentation alignment — swagger + dev docs vs code & direction | M–O |

---

# Part 1 — Test Failure Remediation

> **Context:** virtually ALL failures are TEST-SIDE (stale mocks, drifted expectations, vacuous asserts). The only genuine spec-vs-source conflict is D1 (#147 role assignment).
>
> **Recommended order:** D → A/B/C/E → F/G.
> **Verify after each batch:** `npm run typecheck && npm test`

### A. Stale ESM mocks — missing exports (suite-killing SyntaxErrors)

Tests use `jest.unstable_mockModule()`; merged source now imports symbols the mock factories don't provide. ESM throws at import time, failing every test in the suite. Fix = add missing exports to each factory (prefer `jest.requireActual` spreads so future additions degrade gracefully).

- [ ] **`OrganizationModel` + chainable `findOne().lean()`, `findById().lean()`, `findByIdAndUpdate({new:true}).lean()` missing from model/repo mocks**
      Suites: `tests/organizations.test.ts` (factory :19–57 vs src/modules/organizations/organizations.repo.ts:13–32), `tests/shipments.bulk-status.test.ts`
- [ ] **`refreshToken` (+`registerCompany`, `setup2fa`) missing from `auth/auth.service.js` mocks** (required by auth.controller.ts:2–11)
      Suites: `tests/issue-266-api-key-role-guard.test.ts` (:24–31), `tests/auth.controllers.test.ts` (:105–112)
- [ ] **`findUserById` missing from `users/users.repo.js` mocks** (users.repo.ts:98)
      Suites: `tests/users.list.controller.test.ts` (:66–70), `tests/users.delete.controller.test.ts` (:32–36), `tests/users.service.repo.test.ts` (:18–41), `tests/password-hashing.test.ts` (:187–377 inline divergent copies — consolidate on existing `makeModelMock`)
- [ ] **Controller-imported service surface incomplete** — controller statically imports 15 names (shipments.controller.ts:3–20), mock provides 7
      Suite: `tests/shipments.uploadProof.controller.test.ts` (:27–35)
- [ ] **`getAnalyticsSummary` missing from `analytics/analytics.service.js` mock** (analytics.controller.ts:4)
      Suite: `tests/rbac.matrix.test.ts` (:257–259)
- [ ] **Webhook mocks dead anomaly path** — source migrated to `detectTelemetryAnomalies` (src/services/telemetryAnomalyDetection.js, imported at src/modules/webhooks/iot.service.ts:5) but tests still mock `anomaly.service.js#detectAnomaly`
      Suite: `tests/iot.webhook.service.test.ts` (:39–41, :103–105)

### B. Incomplete query-chain / shape mocks & fixtures

- [ ] **`UserModel.findOne(...).lean is not a function`** — invitation suite leaves real repo active; either mock repo or implement chain (`src/modules/users/users.repo.ts:29`)
      Suite: `tests/issue-352-invitations.test.ts` (:21–22)
- [ ] **refreshToken user stub wrong shape** — stub returns `{ lean }` wrapper but source awaits `UserModel.findById()` directly with NO `.lean()` (auth.service.ts:209) → `user._id` undefined (auth.service.ts:229); also wire up dead `mockFindById` var
      Suite: `tests/issues-288-290-296-297.test.ts` (:81,:94)
- [ ] **Export chain missing `.limit()`** — source: `.find().sort({createdAt:-1}).limit(EXPORT_MAX_RECORDS).lean()` (shipments.service.ts:984)
      Suite: `tests/issues-288-290-296-297.test.ts` (:134–135)
- [ ] **Aggregate facet fixture wrong shape** — fixture `totals:[{total,resolved}]` vs source reading `$facet` outputs `totalAll[0]`/`resolved[0]` (anomaly.service.ts:194–196); expected severity keys lowercase vs uppercase seed (anomaly.service.ts:198)
      Suite: `tests/issues-288-290-296-297.test.ts` (:180–185, :208–209)
- [ ] **`Shipment.findByIdAndUpdate is not a function`** (shipments.service.ts:721)
      Suite: `tests/issue-377-milestone-ledger.test.ts`
- [ ] **`Shipment.aggregate(...).option is not a function`** — `.option` sits on the model object instead of the aggregate return; source chains `.aggregate(p).option({...})` (analytics.service.ts:480–482)
      Suite: `tests/issue-356-analytics-summary.test.ts` (:25,:73)
- [ ] **Storage util mocked at wrong specifier** — test mocks `services/mockStorageService.js` but source imports `uploadFileToStorage` from `../../services/storage/upload.js` (shipments.service.ts:4,:709); real adapter runs with 500ms latency
      Suite: `tests/shipments.service.test.ts` (:34–36)
- [ ] **`Anomaly.aggregate` unmocked in cache suite** — silently depends on global MongoMemoryServer from tests/setup.ts:39–56; flaky when unavailable
      Suite: `tests/analytics.cache.test.ts`

### C. Response-contract & expectation drift (tests assert outdated/impossible behavior)

- [ ] **rateLimiter body evolved** — handler now sends `{ success, message, data: null, retryAfter }` (rateLimiter.ts:145–154); exact `toEqual` at rateLimiter.test.ts:67,:88 breaks. Use `objectContaining`. Also: `strictLimiter` describe builds an inline limiter instead of importing the export (rateLimiter.test.ts:120–128) — exercises zero production code; NODE_ENV restore lacks try/finally (:54–72)
- [ ] **Stale storage URL pattern** — expects `^https://mock-storage\.com/proof`; current MockStorageAdapter returns `https://mock-storage.local/${key}?mock=1&ts=…` (mockStorage.ts:13). Pick canonical fake URL scheme
      Suite: `tests/deliveryProof.test.ts` (:101); also add missing 401/403 cases for POST /:id/proof (route guards ADMIN/MANAGER, shipments.routes.ts:112–114)
- [ ] **Spec-violating expectation** — bulk-status "200 for MANAGER" test sends `shipmentIds: []`, which Zod forbids (shipments.validation.ts:84 `min(1)`) and its sibling test expects 400. Contradictory; fix payload
      Suite: `tests/shipments.bulk-status.test.ts` (:147–154)
- [ ] **Wrong status expectations vs service** — role-permission test expects 400 but service throws 403 FORBIDDEN (invitations.service.ts:77–83); "should return 404…" test actually asserts 401; replace try/catch+expect.fail anti-pattern (:231–241 etc.) with `rejects.toMatchObject`
      Suite: `tests/issue-352-invitations.test.ts` (:244–250, :366)
- [ ] **Cursor meta mis-specified** — asserts `total` inside cursor-mode meta, but controller emits `{ nextCursor, hasMore }` only (users.controller.ts:163–165); fails even after mocks fixed
      Suite: `tests/users.list.controller.test.ts` (:88–92)
- [ ] **Stale thresholds response shape** — expects flat `{ maxTemp, maxHumidity, minBatteryLevel }`; real chain returns `{ shipmentType, thresholds: {…5 keys} }` (telemetry.controller.ts:86 → telemetryThreshold.service.ts:26–30)
      Suite: `tests/telemetry-improvements.test.ts` (:324)
- [ ] **Settlement precondition wrong** — seeds `status:'DELIVERED'` then requests `'DELIVERED'`; source early-returns on same-status (shipments.service.ts:552) BEFORE the ledger hook (:637–650). Seed `OUT_FOR_DELIVERY`
      Suite: `tests/issue-377-milestone-ledger.test.ts` (:199,:211)

### D. Genuine spec/source conflicts (need product decision, not just edits)

- [ ] **D1. #147 admin-domain signup roles — ✅ DECIDED 2026-08-25 (Option A): VIEWER-always policy stands as intentional security measure.** Tests to be aligned via wave issue P2-26 (update expectations + add escalation-guard regression test). No source changes required.
      Suite: `tests/issues-147-150-154-155.test.ts` (also split file — see G5)

### E. Structural / config

- [ ] **env-validation harness measures nothing** — spawns `process.execPath -e 'import "../env.js"'`; relative specifier resolves against CWD → `ERR_MODULE_NOT_FOUND` every run: positives fail, negatives pass vacuously. Fix via `pathToFileURL(new URL('../../src/env.ts', import.meta.url))` + explicit cwd
      Suite: `src/__tests__/env-validation.test.ts` (:18)
- [ ] **Template test broken twice** — `'../src/app.js'` resolves through moduleNameMapper to nonexistent `src/modules/src/app`; use `'../../../src/app.js'` (move to `__tests__/` subdir per repo convention). Also static tokens `'Bearer admin-token'` can never pass requireAuth — mint real JWTs
      Suite: `src/modules/__template__/template.test.ts` (:5,:33,:37–101)
- [ ] **beforeAll 30s cap exceeded on cold app import** — heavy real-DB integration bootstrap under setup's 30s testTimeout (setup.ts:5); move import cost out or raise suite timeout
      Suite: `tests/issues-147-150-154-155.test.ts` (:23)
- [ ] **otplib v12→named-API migration missed** — test imports `authenticator`; source uses named exports `generateSecret/generateURI/verifySync` (twoFactor.service.ts:3)
      Suite: `tests/twoFactor.service.test.ts` (:13)

### F. Vacuous / misleading tests that PASS while testing nothing (fix alongside A–E)

- [ ] **Non-ObjectId ids bypass the code under test** — `'ship-1'` trips `ObjectId.isValid()` guard (telemetryThreshold.service.ts:63–65) → defaults used, custom-threshold branch never executes. Use `new Types.ObjectId()` (helpers exist in tests/fixtures/factories.ts — unused by any failing suite)
      Suite: `tests/anomaly.detect-thresholds.test.ts`
- [ ] **Weak positive assertions can't distinguish success from 500** — `.not.toBe(403)` (issue-266:94,:102,:132,:139,:168,:175); multi-status hedges `[201,400,409]`/`[200,404]`/`[200,400]` let regressions slip (rbac.matrix:358,:418,:441,:463,:488,:510; issues-147:155,:377). Assert exact intended status
- [ ] **Realtime event-name drift causes the socket timeouts** — client awaits `'telemetry_update'` but server emits `'location:update'` (io.ts:128); awaits `'payment_status_changed'` but server emits `'settlement:status'` (io.ts:147). Import event-name constants from src/shared/types/socketEvents.ts instead of string literals
      Suites: `tests/socketio.client.integration.test.ts` (:217), `tests/payments.ws.integration.test.ts` (:71)
- [ ] **Mock lifecycle contamination in SSE suite** — `unstable_mockModule` registered THEN `resetModules()` wipes it (:82→:96), destroying setup.ts global redis mock for all later tests → valid tokens hit REAL Redis and appear revoked. Rule: reset → mock → import
      Suite: `tests/events.sse.test.ts` (also put `useRealTimers` in afterEach)

### G. Systemic refactors (prevent recurrence — do once, delete whole failure classes)

- [ ] **G1. Shared typed model/query-chain helper** — `tests/helpers/fakeModel.ts`: chainable find→sort→skip→limit→select→lean/then + findById/updateMany/aggregate builders typed against mongoose interfaces. Eliminates class B entirely
- [ ] **G2. Shared mock-factory convention** — factories built from `jest.requireActual(module)` spread + overrides, so new exports never break suites again (root cause of all A items)
- [ ] **G3. Fixture consolidation** — Multer file ×3 suites, payment doc ×2, redis mock re-declared per-beforeEach, generateToken ×3, seeded-org literal ×7, invitation args ×9 → extend tests/fixtures/factories.ts
- [ ] **G4. Sync discipline** — replace sleep-based waits (`setTimeout(100/150/500)`) with awaiting server acks (`room_joined`, shipmentRooms.ts:39); bind servers to `port: 0`; fake-timer advancement for setImmediate flushes (iot.webhook:61,:125)
- [ ] **G5. Split issue-bundle suites** — one behavior per file: issues-288-290-296-297 (4 domains), issues-147-150-154-155 (2 domains + real DB), telemetry-improvements (5 concerns, 762 lines)
- [ ] **G6. Derive RBAC matrix from route metadata** instead of hand-duplicating requireRole config; stop `jest.fn<any>()`/`as any` in tests (violates no-any gate); remove console.log from socket integration tests; duplicate object keys surviving transpile-only (iot.webhook ×3, rbac:188/:191)
- [ ] **G7. Backfill contract-matrix gaps** vs AGENTS §4 (200/401/403/400/422): users.list missing 401; organizations PATCH/DELETE missing 401/404; proof route missing 401/403 anywhere; shipment-create missing 403; api-key routes missing 400

---

# Part 2 — Containerization Review

> **Status:** Dockerfile (3-stage, node:20-alpine), `docker-compose.yml` (mongo/redis/app), thin `.dockerignore`. Skeleton-quality dev scaffolding — **the shipped stack cannot even boot** (H1.1 proves it was never run end-to-end). Zero Docker verification in CI; zero mention in README.

### H1. P0 — Blockers (crash-loop / security defaults)

- [x] **H1.0. `npm ci --omit=dev` crash in Docker** — `"prepare": "husky"` ran on prod install where husky (devDep) is absent → exit 127. FIXED 2026-08-25: `prepare` → `husky || true` + `ENV HUSKY=0` in both Docker stages. Found by the new CI docker-build job on its first run

- [ ] **H1.1. App crash-loops on startup** — `docker-compose.yml:30` sets `JWT_SECRET=dev-secret-key-replace-in-prod` (30 chars); src/env.ts:11 requires `min(32)` → `process.exit(1)` (src/env.ts:89) on every boot. Fix the secret length; consider `env_file:` so this can't recur
- [ ] **H1.2. Container runs as root** — no `USER node` in runner stage (Dockerfile:16–33)
- [ ] **H1.3. No `ENV NODE_ENV=production`** in the runner image — mode left to compose, which hardcodes `development` (docker-compose.yml:26) against a production-built artifact
- [ ] **H1.4. Startup race masked by restart loops** — bare `depends_on` (docker-compose.yml:32–34); mongo/redis define no healthchecks → app exits until Mongo happens to be ready. Add healthchecks + `depends_on.condition: service_healthy`

### H2. P1 — Production readiness

- [ ] **H2.1. Migrations never run** — `migrate:mongo up` isn't wired into any entrypoint or one-shot compose service (migrations/ currently holds one compound-index migration)
- [ ] **H2.2. Worker topology undefined** — package.json ships `worker:stellar` / `worker:stellar-indexer` entry points but neither main.ts nor compose runs them, while main.ts starts alert+maintenance BullMQ workers *in-process*. Decide: dedicated worker services vs documented single-process mode
- [ ] **H2.3. Secret/config management** — only 6 of ~40 env vars settable; secrets inline in repo compose file. Adopt `env_file:` (.env.docker pattern, gitignored) or compose secrets
- [ ] **H2.4. Redis durability** — no persistent volume for redis → BullMQ queue jobs lost on restart. Add `appendonly` + volume or document ephemerality
- [ ] **H2.5. Mongo auth** — mongo runs unauthenticated (no `MONGO_INITDB_ROOT_USERNAME`), URI carries no credentials

### H3. P2 — Hygiene & developer experience

- [ ] **H3.1. Thin `.dockerignore`** — tests/.github/reports/*.md/demo-client.html ship into build context; tighten
- [ ] **H3.2. BuildKit cache mounts** — both `npm ci` layers (Dockerfile:5,:11) rebuild cold; add `--mount=type=cache`
- [ ] **H3.3. Dev workflow** — no `compose.override.yml` / hot-reload target (tsx watch); dev story = rebuild prod image
- [ ] **H3.4. Compose modernization** — drop obsolete `version: '3.8'` key; remove fixed `container_name`s (block parallel stacks); bind mongo/redis ports to `127.0.0.1` or stop publishing; add resource limits/logging config
- [ ] **H3.5. Documentation** — no Docker section in README (quickstart, env matrix, topology diagram incl. workers)

### H4. CI/CD gaps

> **DECISION (2026-08-25):** Tests are deliberately EXCLUDED from PR CI until the contribution-review alignment pass. Rationale: the suite is currently fragile (ESM VM modules, infra-dependent, 28 red suites) and would generate pure noise on every PR. Residual risk accepted: mock/test rot and behavioral regressions accumulate silently in the interim — typecheck/build/check:deps only catch source-level breakage. Mitigation options recorded below.

- [ ] **H4.1. No Docker verification** — typecheck.yml is the only workflow; nothing builds the image or runs a compose smoke test
- [ ] **H4.2. Missing quality gates in CI** — lint job addable immediately (currently green); tests deferred per decision above. Rollout: (1) restructure into `ci.yml` with parallel jobs: deps-audit+typecheck+build, lint, docker-build (paths-filtered); (2) OPTIONAL heartbeat: `tests-nightly.yml` with `workflow_dispatch` + weekly `schedule:` — never on PRs — as a passive drift record for the future review pass; (3) after Part 1 remediation completes during the review pass, add `tests` as a REQUIRED gate per the closeout sequence (remove continue-on-error → branch protection → README/AGENTS caveats)
- [ ] **H4.3. Dependabot config** — `.github/dependabot.yml` for npm + GitHub Actions ecosystems
- [ ] **H4.4. Branch protection** — mark existing checks required once jobs exist; add `tests` to required set only after the review-pass alignment

---

# Part 3 — Hash-and-Emit Chain Integration (Backend Prep)

> **Context:** The Navin pattern is: hash payloads off-chain → submit minimal data + hash to a Soroban contract → contract validates & emits `(shipmentId, status, dataHash)` events → backend indexes `txHash + dataHash` into MongoDB → frontend verifies against Horizon/RPC directly.
>
> **Status vs pattern:** Step 1 ~70% (hashing exists, telemetry-only) · Step 2 0% (no Soroban client — current code uses Horizon `manageData` placeholders; escrow is simulated) · Step 3 ~60% (workers exist, but infer milestones from memos; `LedgerBlock` lacks `dataHash`) · Step 4 ~30% (no verification-bundle endpoint).
>
> **Constraint:** the Soroban contracts live in a separate repo and are NOT yet implemented. Strategy: freeze the interface spec first, build backend against it behind an adapter port with a simulated implementation, enforce alignment via golden-vector tests.

## I. Interface spec — co-designed artifact (freeze before any chain code)

- [ ] **I1. Write `docs/chain-interface.md`** — single source of truth, versioned:
      · Functions: `anchor(shipment_id: Symbol, data_hash: BytesN<32>, actor: Address)`, `init_escrow(...)`, `release_escrow(payment_id, proof_hash)` + authorization rules per function
      · Events: topic names + data tuples (e.g. `topic: ["anchor", shipment_id]`, `data: (data_hash, ledger)`)
      · Error taxonomy mapped to backend `ERR_CHAIN_*` codes (register in src/shared/http/errors.ts)
- [ ] **I2. Mirror spec as TS** — `src/shared/types/chain.ts`; both repos PR against the doc, changes bump spec version. Backend touches chain shapes ONLY through this file

## J. Port / adapter layer (backend builds before contracts exist)

- [ ] **J1. Define `ChainAdapter` port** — `src/services/chain/types.ts`:
      `anchorEvent(input): Promise<{txHash, ledger}>` · `releaseEscrow(input): Promise<EscrowResult>` (throws AppError on failure — replaces silent `{success:false}` at stellar.service.ts:157–160) · `streamEvents(cursor?): AsyncIterable<ChainEvent>`
- [ ] **J2. `SimulatedAdapter`** — wraps current manage-data behavior behind the port; responses flagged `"simulated": true` so demos don't imply real escrow
- [ ] **J3. Config-selected factory** — call sites (telemetry.service.ts:239 anchor job, shipments.service.ts:624 settlement) depend only on the port; `SOROBAN_ADAPTER=simulated|soroban` flips implementations
- [ ] **J4. Signing safety from day one** — serialize submissions per account or use channel accounts inside the adapter (current stellar.worker concurrency:5 against one keypair will `tx_bad_seq` under load)

## K. Scaffold-step work packages

### K1. Step 1 — Hash & emit coverage (off-chain trigger)
- [ ] Extend `generateDataHash` usage to ALL event classes — milestones, status changes, proof uploads (currently telemetry-only: telemetry.service.ts:220, iot.service.ts:87)
- [ ] Persist canonical payload alongside each `dataHash` so verification can recompute byte-exact hashes

### K2. Step 2 — Contract execution layer
- [ ] `SorobanAdapter`: RPC client → `simulateTransaction` (catch errors pre-fee) → assemble → sign → `sendTransaction` → poll `getTransaction` to confirmed
- [ ] Replace placeholder ops: `releaseEscrow()` manageData fake (stellar.service.ts:118–161) becomes real contract call once deployed
- [ ] Fix hardcoded Horizon URL bug — `new Horizon.Server('https://horizon-testnet.stellar.org')` ignores `config.stellarNetwork` (stellar.service.ts:14)
- [ ] Keep validation logic (shipment active? caller authorized?) in the CONTRACT — backend only submits

### K3. Step 3 — Event-driven indexer (replaces memo inference)
- [ ] Rewrite stellar-indexer.worker.ts to consume `adapter.streamEvents()` (`getEvents` filtered by contract ID) instead of guessing milestones from memo substrings (`toMilestoneEvent`, :28–35)
- [ ] Add `dataHash` field to `LedgerBlock` model (ledger.model.ts:5–23 currently has txHash only)
- [ ] Kill dual-field split-brain: indexer writes `eventType` while API filters required `milestoneEvent` (indexer upserts bypass schema validation) — one canonical field
- [ ] Stop citing stale txs: status-change blocks reuse creation-time `stellarTxHash` for unrelated events (shipments.service.ts:608)
- [ ] Extend confirmation tracking (≥3 ledgers) from payments-only to all anchored records incl. telemetry

### K4. Step 4 — Verification support (trustless frontend)
- [ ] `GET /api/ledger/blocks/:id/verification` → `{ canonicalPayload, dataHash, txHash, ledger }` — everything the FE needs to recompute SHA-256 and compare against Horizon/RPC without trusting this API
- [ ] Document FE verification flow in docs (query chain directly → compare hashes → badge)

## L. Alignment enforcement (mechanical, not goodwill)

- [ ] **L1. Golden-vector tests** — fixture payloads → expected hashes; recorded contract-event JSON → expected LedgerBlock rows. Real contract's emissions must match fixtures byte-for-byte or CI fails
- [ ] **L2. Contract-test harness** — Stellar quickstart docker (standalone network) in CI; SorobanAdapter integration-tested against a stub contract emitting spec'd events before the real contract lands
- [ ] **L3. Acceptance scripts = demo = conformance suite** — four runnable scenarios: (1) scan → anchored (2) deliver → escrow released (3) indexer ingests emitted event (4) FE verifies badge via bundle endpoint
- [ ] **L4. Sequencing safety gate** — load test adapter at concurrency >1 before merging; assert zero sequence-number failures
- [ ] **L5. Port-only mocking convention** — shared `tests/helpers/fakeChainAdapter.ts` (scriptable: emit events into `streamEvents()`, fail-N-then-succeed, malformed-event injection); migrate the ~10 suites currently mocking `stellar.service.js`/ledger internals directly; enforce with ESLint `no-restricted-imports` on test files
- [ ] **L6. Dual-binding adapter contract suite + honesty asserts** — one behavioral suite executed against Simulated AND Soroban adapters (byte-identical expectations); test asserts `"simulated": true` present in API responses while simulated adapter is active
- [ ] **L7. Golden fixtures as cross-repo artifact** — `tests/fixtures/chain/` payloads/events validated by Zod schemas mirrored from src/shared/types/chain.ts; hand the event fixtures to the contracts repo as their emission target — drift fails CI on whichever side changes first

---

# Part 4 — Documentation Alignment (2026-08-25 audit)

> **Audit verdicts:** swagger.yaml ≈65% trustworthy · ERROR_CODES.md misleading · storage-adapter.md obsolete · CONTRIBUTING had Rust copy-paste · 2 dead meta-docs removed.
> **Doc truth map going forward:** README = run it · docs/swagger.yaml = API truth · docs/chain-interface.md = chain truth (TODO I1) · TODO.md = what's next · CHANGELOG = what changed. Snapshot analyses → `docs/archive/`.

### ✅ Structural cleanup (done 2026-08-25)

- [x] Deleted `issues.md` (all items verifiably done) and `backend-compatibility-guide-check.md` (dead AI audit; advice violated repo rules)
- [x] Archived `backend-integration-requirements.md` → `docs/archive/frontend-integration-requirements.md` with superseded banner; repointed `tests/README.md`
- [x] Moved `demo-client.html` → `examples/demo-client.html` + fixed dead event names (`telemetry_update/status_update/anomaly_detected` → `location:update/shipment:status/anomaly:detected`)
- [x] CONTRIBUTING.md: Rust→TypeScript prereqs/env checks; CI gate table made honest (lint+tests currently not enforced)

### M. swagger.yaml remediation (≈5,886 lines; fix in this order)

- [ ] **M1. Rewrite notifications section** (~L339–441): remove `x-implemented:false` 501 stubs; document 9 live routes incl. `unread-count`, `read-all`; fix OTP paths to `/phone/send-otp|verify-otp`; preferences PUT→PATCH
- [ ] **M2. Delete duplicate settlements block** (L3125–3343 duplicates L2879–3058) and repair corrupted `/api/settlements/{id}` (L2994–3050: two `summary:` keys, stray fragment, conflicting schemas)
- [ ] **M3. Remove ghosts**: `/api/addresses`+`/{id}` (L252–338, nothing mounted), `PATCH /api/shipments/bulk/status` (L4374 — orphan Zod schema only)
- [ ] **M4. Add missing paths**: `POST /api/auth/refresh` (referenced in prose twice, never defined); `/api/company/api-keys` CRUD (current module absent from spec); `GET /api/shipments/export`; `GET /api/anomalies/stats`
- [ ] **M5. Fix ErrorResponse component** (L5404): add `error.code` + optional `details[]` per errorMiddleware.ts:19–23; enumerate ERR_* codes — currently 0% of documented errors model the code contract clients branch on
- [ ] **M6. Populate empty organizations paths** (L3544, L3618) — 10 invisible SUPER_ADMIN endpoints
- [ ] **M7. Ledger param rename** `eventType`→`milestoneEvent` (L4704–4708 vs ledger.validation.ts:12)
- [ ] **M8. Response schemas**: POST /shipments 201 + PATCH status 200 have none; payments query missing shipmentId/sortBy/sortOrder/page; login email needs `format: email`
- [ ] **M9. Dedupe `/auth/2fa/setup`** (keep richer L1700 block); add operationIds globally; machine-readable roles via `x-required-role`

### N. Dev docs updates

- [ ] **N1. ERROR_CODES.md — REWRITE (highest priority)**: doc's flagship 400 example is wrong (validation returns raw `'VALIDATION_ERROR'` from validate.ts:33,39, not `ERR_VALIDATION_FAILED`); revoked-token code mismatch (requireAuth.ts:37 literal `'TOKEN_REVOKED'` vs documented `ERR_AUTH_TOKEN_REVOKED` — SSE-only); add ~15 used-but-undocumented codes (SHIPMENT_INVALID_TRANSITION, ORGANIZATION_NOT_FOUND, STELLAR_*, LEDGER_BLOCK_NOT_FOUND, FILE_*, AUTH_2FA_*, SETTLEMENT_*, …); document 429 shape (no code field, meta.retryAfter); decide policy for ad-hoc off-registry codes (EMAIL_TAKEN, INVALID_ROLE, …)
- [ ] **N2. storage-adapter.md — REWRITE as current-state reference**: factory + mock/s3/r2/cloudinary all shipped (storage/index.ts:29–63); "no runtime provider switch" claim false; mock URL is `mock-storage.local` scheme; deprecate legacy `mockStorageService.ts` shim in prose
- [ ] **N3. blockchain.md — SPLIT + REWRITE**: move §Target contract methods (:64–105) into new docs/chain-interface.md as co-design seed; rewrite migration plan around ChainAdapter port (not config-presence flagging); correct gap table (polling indexer EXISTS — stellar-indexer.worker.ts:112–132, not "N/A"); note releaseEscrow swallows errors; keep candid "fallback ≠ escrow" language
- [ ] **N4. telemetry-pipeline.md — UPDATE**: delete false "legacy 85/90 endpoint" section (GET /thresholds routes to org-threshold service; hardcoded fn at telemetry.service.ts:188–190 has zero callers = dead code); rewrite anomaly sections around `detectTelemetryAnomalies` (TEMPERATURE_BREACH/HUMIDITY_BREACH/SHOCK_EVENT/GPS_LOST/BATTERY_LOW; webhook severity always HIGH); fix event labels to `location:update`/`anomaly:detected`
- [ ] **N5. auth-model.md — UPDATE**: DRIVER role exists (invitable per invitations.service.ts:69 — though no route guard grants it anything); persona claim shipped; add Sessions §, 2FA § (otplib named-API, TOTP_ENCRYPTION_KEY, login does NOT yet challenge 2FA), register-company public route; fix audit-log matrix row (VIEWER allowed); add token-TTL table (access 7d, refresh grace ≤7d, blocklist keys)
- [ ] **N6. websockets.md — UPDATE**: auth example must send RAW JWT (socketAuth does not strip Bearer — current example fails handshake); full 9-status enum for `shipment:status`; mark `notification:new` as defined-but-dead (zero emitters, no join path); `.js`→`.ts` ref; note SSE fanout
- [ ] **N7. environment-variables.md — UPDATE**: add TOTP_ENCRYPTION_KEY, Cloudinary trio; flip STORAGE_PROVIDER/S3_* to validated+used (incl. `r2`); reconcile FRONTEND_URL default (env.ts:69 says :3000, .env.example says :5173)
- [ ] **N8. DATABASE.md — UPDATE**: add Migrations § (migrate-mongo workflow, changelog collection, scripts); extend index coverage (LedgerBlock, ApiKey, anchorStatus, severity); fix text-index columns (missing trackingNumber); placeholder note for future dataHash index
- [x] **N9. PAGINATION.md — UPDATE**: users dual-mode is LIVE (not "(target)"); document payments deviation (meta always includes total); add shipment-timeline to cursor list

### O. Root docs & conventions

- [ ] **O1. README.md — UPDATE**: scripts table wrong (`migrations:up` → `migrate:up`; missing seed/worker:stellar/worker:stellar-indexer/test:watch); env table fictional (invents STELLAR_HORIZON_URL/JWT_EXPIRY/API_KEY_PREFIX; claims JWT_SECRET optional — it's required min-32, process.exit otherwise) → replace with pointer to docs/environment-variables.md; socket example listens to dead `shipment:updated` (real: `shipment:status`); add Docker § when Part 2 lands; add test-suite-status caveat
- [ ] **O2. CHANGELOG.md — minor**: collapse three consecutive `### Changed` headings (:22,:41,:58)
- [ ] **O3. AGENTS.md §7 — add chain-port boundary row** before Part 3 coding starts: consumers telemetry/payments/shipments → src/services/chain (port types only); also note AGENTS §4 "npm test before done" gate is aspirational until Part 1 completes
- [ ] **O4. Husky decision** — `.husky/` contains no pre-commit hook; lint-staged config never fires. Either wire the hook or remove husky+lint-staged deps (CONTRIBUTING implies gates that don't exist)

> **Build order:** I (spec freeze) → J1–J4 + K3 model fixes (no behavior change) → K3 indexer rewrite → K2 adapter vs stub contract → config flip when real contract deploys → K4 last (needs indexed dataHashes).
