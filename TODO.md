# navin-backend — Project TODO

Last updated: 2026-10-17 · branch `main` @ `113522d`

## Contents

| Part | Scope | Sections |
|---|---|---|
| **1** | Test failure remediation — 28 failed suites / 160 failed tests | A–G |
| **2** | Containerization review — Dockerfile / compose / CI gaps | H |
| **3** | Hash-and-Emit chain integration — backend prep for Soroban contracts (interface co-design phase) | I–L |
| **4** | Documentation alignment — swagger + dev docs vs code & direction | M–O |

---

# Part 1 — Test Failure Remediation

> **Context:** All initial test failures and mock rot remediated across Wave Phases 1, 2, 5, and 7.
> **Current Status:** Static gates (`lint`, `typecheck`, `check:deps`) are 100% green.

### A. Stale ESM mocks — missing exports (suite-killing SyntaxErrors)

- [x] **`OrganizationModel` + chainable `findOne().lean()`, `findById().lean()`, `findByIdAndUpdate({new:true}).lean()` missing from model/repo mocks**
      Suites: `tests/organizations.test.ts`, `tests/shipments.bulk-status.test.ts` — ✅ FIXED (#621, #748)
- [x] **`refreshToken` (+`registerCompany`, `setup2fa`) missing from `auth/auth.service.js` mocks** (required by auth.controller.ts:2–11)
      Suites: `tests/issue-266-api-key-role-guard.test.ts`, `tests/auth.controllers.test.ts` — ✅ FIXED (#622, #768)
- [x] **`findUserById` missing from `users/users.repo.js` mocks** (users.repo.ts:98)
      Suites: `tests/users.list.controller.test.ts`, `tests/users.delete.controller.test.ts`, `tests/users.service.repo.test.ts`, `tests/password-hashing.test.ts` — ✅ FIXED (#748, #749)
- [x] **Controller-imported service surface incomplete** — controller statically imports 15 names (shipments.controller.ts:3–20), mock provides 7
      Suite: `tests/shipments.uploadProof.controller.test.ts` — ✅ FIXED (#621)
- [x] **`getAnalyticsSummary` missing from `analytics/analytics.service.js` mock** (analytics.controller.ts:4)
      Suite: `tests/rbac.matrix.test.ts` — ✅ FIXED (#622)
- [x] **Webhook mocks dead anomaly path** — source migrated to `detectTelemetryAnomalies` (src/services/telemetryAnomalyDetection.js)
      Suite: `tests/iot.webhook.service.test.ts` — ✅ FIXED (#623)

### B. Incomplete query-chain / shape mocks & fixtures

- [x] **`UserModel.findOne(...).lean is not a function`** — invitation suite leaves real repo active
      Suite: `tests/issue-352-invitations.test.ts` — ✅ FIXED (#624, #750)
- [x] **refreshToken user stub wrong shape** — stub returns `{ lean }` wrapper but source awaits `UserModel.findById()` directly
      Suite: `tests/issues-288-290-296-297.test.ts` / split suites — ✅ FIXED (#769)
- [x] **Export chain missing `.limit()`** — source: `.find().sort({createdAt:-1}).limit(EXPORT_MAX_RECORDS).lean()`
      Suite: `tests/shipments.export.test.ts` — ✅ FIXED
- [x] **Aggregate facet fixture wrong shape** — fixture `totals:[{total,resolved}]` vs source reading `$facet` outputs
      Suite: `tests/anomaly.stats.test.ts` — ✅ FIXED
- [x] **`Shipment.findByIdAndUpdate is not a function`**
      Suite: `tests/issue-377-milestone-ledger.test.ts` — ✅ FIXED
- [x] **`Shipment.aggregate(...).option is not a function`** — `.option` sits on the model object instead of the aggregate return
      Suite: `tests/issue-356-analytics-summary.test.ts` — ✅ FIXED
- [x] **Storage util mocked at wrong specifier** — test mocks `services/mockStorageService.js` vs `../../services/storage/upload.js`
      Suite: `tests/shipments.service.test.ts` — ✅ FIXED (#625)
- [x] **`Anomaly.aggregate` unmocked in cache suite** — silently depends on global MongoMemoryServer
      Suite: `tests/analytics.cache.test.ts` — ✅ FIXED

### C. Response-contract & expectation drift (tests assert outdated/impossible behavior)

- [x] **rateLimiter body evolved** — handler now sends `{ success, message, data: null, retryAfter }`
      Suite: `src/shared/middleware/__tests__/rateLimiter.test.ts` — ✅ FIXED (#547)
- [x] **Stale storage URL pattern** — expects `^https://mock-storage\.com/proof` vs `mock-storage.local`
      Suite: `tests/deliveryProof.test.ts` — ✅ FIXED (#548)
- [x] **Spec-violating expectation** — bulk-status "200 for MANAGER" test sends `shipmentIds: []`
      Suite: `tests/shipments.bulk-status.test.ts` — ✅ FIXED (#549)
- [x] **Wrong status expectations vs service** — role-permission test expects 400 but service throws 403 FORBIDDEN
      Suite: `tests/issue-352-invitations.test.ts` — ✅ FIXED (#550)
- [x] **Cursor meta mis-specified** — asserts `total` inside cursor-mode meta
      Suite: `tests/users.list.controller.test.ts` — ✅ FIXED (#551)
- [x] **Stale thresholds response shape** — expects flat `{ maxTemp, maxHumidity, minBatteryLevel }`
      Suite: `tests/telemetry-improvements.test.ts` / split suites — ✅ FIXED (#552)
- [x] **Settlement precondition wrong** — seeds `status:'DELIVERED'` then requests `'DELIVERED'`
      Suite: `tests/issue-377-milestone-ledger.test.ts` — ✅ FIXED (#553)

### D. Genuine spec/source conflicts (need product decision, not just edits)

- [x] **D1. #147 admin-domain signup roles — ✅ DECIDED 2026-08-25 (Option A): VIEWER-always policy stands as intentional security measure.**
      Suite: `tests/auth.signup.policy.test.ts`, `tests/issues-147-150-154-155.test.ts` — ✅ ALIGNED (#754, #755, #756)

### E. Structural / config

- [x] **env-validation harness measures nothing** — spawns `process.execPath -e 'import "../env.js"'`
      Suite: `src/__tests__/env-validation.test.ts` — ✅ FIXED (#535)
- [x] **Template test broken twice** — `'../src/app.js'` resolves to nonexistent `src/modules/src/app`
      Suite: `src/modules/__template__/template.test.ts` — ✅ FIXED (#536)
- [x] **beforeAll 30s cap exceeded on cold app import** — cold-start integration bootstrap timeout
      Suite: `tests/setup.ts` — ✅ FIXED (#537, #772)
- [x] **otplib v12→named-API migration missed** — test imports `authenticator`
      Suite: `tests/twoFactor.service.test.ts` — ✅ FIXED (#538)

### F. Vacuous / misleading tests that PASS while testing nothing (fix alongside A–E)

- [x] **Non-ObjectId ids bypass the code under test** — `'ship-1'` trips `ObjectId.isValid()` guard
      Suite: `tests/anomaly.detect-thresholds.test.ts` — ✅ FIXED (#554)
- [x] **Weak positive assertions can't distinguish success from 500** — `.not.toBe(403)` hedges
      Suites: `tests/issue-266-api-key-role-guard.test.ts`, `tests/rbac.matrix.test.ts` — ✅ FIXED (#555)
- [x] **Realtime event-name drift causes the socket timeouts** — client awaits `'telemetry_update'`
      Suites: `tests/socketio.client.integration.test.ts`, `tests/payments.ws.integration.test.ts` — ✅ FIXED (#757, #758, #763)
- [x] **Mock lifecycle contamination in SSE suite** — `unstable_mockModule` registered then `resetModules()`
      Suite: `tests/events.sse.test.ts` — ✅ FIXED (#764, #765)

### G. Systemic refactors (prevent recurrence — do once, delete whole failure classes)

- [x] **G1. Shared typed model/query-chain helper** — `tests/helpers/fakeModel.ts` — ✅ DONE (#533)
- [x] **G2. Shared mock-factory convention** — `tests/helpers/mockFactory.ts` — ✅ DONE (#534)
- [x] **G3. Fixture consolidation** — `tests/fixtures/factories.ts` extended — ✅ DONE (#613)
- [x] **G4. Sync discipline** — awaiting server acks, ephemeral port binding, `tests/helpers/flush.ts` — ✅ DONE (#614)
- [x] **G5. Split issue-bundle suites** — multi-domain issue bundles split and deleted — ✅ DONE (#615)
- [x] **G6. Derive RBAC matrix from route metadata** — `routeRoles` exported and consumed in `tests/rbac.matrix.test.ts` — ✅ DONE (#616, #710)
- [x] **G7. Backfill contract-matrix gaps** vs AGENTS §4 (200/401/403/400/422) — ✅ DONE (#617)

---

# Part 2 — Containerization Review

> **Status:** Stack fully bootable; compose smoke tests & durability verified in CI.

### H1. P0 — Blockers (crash-loop / security defaults)

- [x] **H1.0. `npm ci --omit=dev` crash in Docker** — `"prepare": "husky"` ran on prod install. FIXED 2026-08-25: `prepare` → `husky || true` + `ENV HUSKY=0`
- [x] **H1.1. App crash-loops on startup** — `JWT_SECRET` min 32 chars in compose & `.env.docker.example` — ✅ FIXED (#539)
- [x] **H1.2. Container runs as root** — `USER node` in runner stage (Dockerfile) — ✅ FIXED (#540)
- [x] **H1.3. No `ENV NODE_ENV=production`** in the runner image — ✅ FIXED (#499, #541)
- [x] **H1.4. Startup race masked by restart loops** — healthchecks + `depends_on.condition: service_healthy` — ✅ FIXED (#542)

### H2. P1 — Production readiness

- [x] **H2.1. Migrations never run** — one-shot `migrate` compose service runs `migrate:up` after mongo healthy — ✅ FIXED
- [x] **H2.2. Worker topology undefined** — dedicated `stellar-worker` and `stellar-indexer` compose services, documented in `docs/adr-worker-topology.md` — ✅ FIXED (#600)
- [x] **H2.3. Secret/config management** — `env_file: .env.docker` pattern with `.env.docker.example` committed — ✅ FIXED (#598, #737)
- [x] **H2.4. Redis durability** — appendonly enabled + `redis_data` volume + verified via CI probe — ✅ FIXED (#596, #637)
- [x] **H2.5. Mongo auth** — `MONGO_INITDB_ROOT_USERNAME` / `MONGO_INITDB_ROOT_PASSWORD` configured and authenticated in URI — ✅ FIXED (#597, #735)

### H3. P2 — Hygiene & developer experience

- [x] **H3.1. Thin `.dockerignore`** — tightened ignore list excludes tests, reports, markdown, .agents — ✅ FIXED (#543)
- [x] **H3.2. BuildKit cache mounts / GHA caching** — cached via GitHub Actions docker build cache — ✅ DONE
- [x] **H3.3. Dev workflow** — `docker-compose.override.yml` + `dev` stage in Dockerfile for hot reload — ✅ FIXED (#602)
- [x] **H3.4. Compose modernization** — obsolete `version` key removed; loopback-only host bindings; limits and logging configured — ✅ FIXED (#601, #605, #638, #736)

### H4. CI/CD gaps

- [x] **H4.1. No Docker verification** — image build and compose smoke test added to `ci.yml` — ✅ FIXED (#603)
- [x] **H4.2. Missing quality gates in CI** — `ci.yml` with parallel verify, lint, openapi-lint, docker, compose-smoke, and redis-persistence jobs — ✅ FIXED
- [x] **H4.3. Dependabot config** — `.github/dependabot.yml` active for npm + github-actions — ✅ FIXED (#544)
- [x] **H4.4. Branch protection** — required status checks documented in `CONTRIBUTING.md` — ✅ FIXED (#545)
- [x] **H4.5. Tests as a blocking PR check** — `test` job (mongo + redis services) added to `ci.yml`; `tests-nightly.yml` heartbeat removed — ✅ FIXED

---

# Part 3 — Hash-and-Emit Chain Integration (Backend Prep)

> **Context:** The Navin pattern is: hash payloads off-chain → submit minimal data + hash to a Soroban contract → contract validates & emits `(shipmentId, status, dataHash)` events → backend indexes `txHash + dataHash` into MongoDB → frontend verifies against Horizon/RPC directly.

## I. Interface spec — co-designed artifact (freeze before any chain code)

- [x] **I1. Write `docs/chain-interface.md`** — single source of truth, versioned — ✅ DONE (#727 / #649)
- [x] **I2. Mirror spec as TS** — `src/shared/types/chain.ts` with Zod schemas, `CHAIN_SPEC_VERSION`, error map, `parseChainEvent`, golden fixtures — ✅ DONE (#651)

## J. Port / adapter layer (backend builds before contracts exist)

- [x] **J1. Define `ChainAdapter` port** — `src/services/chain/types.ts` live with `ChainAdapter` interface, `AnchorResult`, `EscrowResult`, `ChainTxReceipt` — ✅ DONE (#650)
- [x] **J2. `SimulatedAdapter`** — `src/services/chain/simulated.adapter.ts` live with `simulated: true` receipts and `KeyedSerializer` — ✅ DONE (#650)
- [x] **J3. Config-selected factory** — `src/services/chain/factory.ts` and env schema live with `SOROBAN_ADAPTER` — ✅ DONE (#653; note: SorobanAdapter instantiation follow-up tracked)
- [x] **J4. Signing safety from day one** — per-account serializer `KeyedSerializer` in `src/services/chain/serializer.ts` — ✅ DONE (#653, #692)

## K. Scaffold-step work packages

### K1. Step 1 — Hash & emit coverage (off-chain trigger)
- [x] Extend `generateDataHash` usage to ALL event classes — telemetry, IoT, status changes, proof uploads, settlement — ✅ DONE (#654)
- [x] Persist canonical payload alongside each `dataHash` — `ILedgerBlock.canonicalPayload` persisted; `buildCanonicalShipmentPayload` — ✅ DONE (#655; note: status-change top-level payload pass follow-up tracked)

### K2. Step 2 — Contract execution layer
- [x] `SorobanAdapter`: RPC client → `simulateTransaction` → assemble → sign → `sendTransaction` → poll — ✅ DONE (`src/services/chain/soroban.adapter.ts`, #656)
- [x] Replace placeholder ops: `releaseEscrow()` manageData fake delegates to `adapter.releaseEscrow()` — ✅ DONE (#657)
- [x] Fix hardcoded Horizon URL bug — `config.horizonUrl` derived from `STELLAR_NETWORK` — ✅ DONE (#658)
- [x] Keep validation logic in the CONTRACT — backend only submits — ✅ DONE

### K3. Step 3 — Event-driven indexer (replaces memo inference)
- [x] Rewrite stellar-indexer.worker.ts to consume `adapter.streamEvents()` — ✅ DONE (#662)
- [x] Add `dataHash` field to `LedgerBlock` model (`ledger.model.ts` + migration) — ✅ DONE (#660)
- [x] Kill dual-field split-brain: canonical `milestoneEvent` field on `ILedgerBlock` — ✅ DONE (#661; note: indexer updateOne field alignment follow-up tracked)
- [x] Stop citing stale txs: status-change blocks no longer reuse creation-time `stellarTxHash` — ✅ DONE (#663)
- [ ] Extend confirmation tracking (≥3 ledgers) from payments-only to all anchored records incl. telemetry — Follow-up tracked in Phase 8

### K4. Step 4 — Verification support (trustless frontend)
- [x] `GET /api/ledger/blocks/:id/verification` → `{ canonicalPayload, dataHash, txHash, ledger }` — ✅ DONE (#665)
- [ ] Document FE verification flow in docs (query chain directly → compare hashes → badge) — Follow-up tracked in Phase 8

## L. Alignment enforcement (mechanical, not goodwill)

- [x] **L1. Golden-vector tests** — `tests/indexer.golden.test.ts` + `tests/fixtures/chain/` — ✅ DONE (#666)
- [ ] **L2. Contract-test harness** — Stellar quickstart docker (standalone network) in CI — Follow-up tracked in Phase 8
- [ ] **L3. Acceptance scripts = demo = conformance suite** — 4 runnable scenarios in `scripts/acceptance/` — Follow-up tracked in Phase 8
- [x] **L4. Sequencing safety gate** — `tests/chain.signing-concurrency.test.ts` — ✅ DONE (#669)
- [x] **L5. Port-only mocking convention** — `tests/helpers/fakeChainAdapter.ts` + `tests/helpers/mocks.ts` — ✅ DONE (#670; test mock migration open in #719)
- [x] **L6. Dual-binding adapter contract suite** — `tests/chain.adapter.contract.test.ts` — ✅ DONE (#671; parity expansion follow-up tracked)
- [x] **L7. Golden fixtures as cross-repo artifact** — `tests/fixtures/chain/` payloads/events validated by Zod schemas — ✅ DONE (#666)

---

# Part 4 — Documentation Alignment

### M. swagger.yaml remediation

- [x] **M1. Rewrite notifications section** — live routes documented, OTP paths fixed, preferences PATCH — ✅ DONE (#559)
- [x] **M2. Delete duplicate settlements block** and repair corrupted `/api/settlements/{id}` — ✅ DONE (#560)
- [x] **M3. Remove ghosts**: `/api/addresses` removed; `PATCH /api/shipments/bulk/status` documented — ✅ DONE
- [x] **M4. Add missing paths**: `POST /api/auth/refresh`, `/api/company/api-keys`, export, anomaly stats — ✅ DONE
- [x] **M5. Fix ErrorResponse component**: `error.code` + `details[]` added per errorMiddleware — ✅ DONE
- [x] **M6. Populate empty organizations paths** — POST, GET list, GET/PATCH by id documented — ✅ DONE (#634; DELETE endpoint docs follow-up tracked)
- [x] **M7. Ledger param rename** `eventType`→`milestoneEvent` query param renamed — ✅ DONE
- [x] **M8. Response schemas**: POST /shipments 201 + PATCH status 200, payments query params, login email format — ✅ DONE
- [x] **M9. Dedupe `/auth/2fa/setup`**; add operationIds globally; machine-readable roles via `x-required-role` — ✅ DONE (#567)

### N. Dev docs updates

- [x] **N1. ERROR_CODES.md — REWRITE**: `ERR_CHAIN_*`, `ERR_AUTH_2FA_*`, `ERR_FILE_*`, `ERR_AUTH_INVALID_TOKEN_IDENTIFIER` added — ✅ DONE (#650, #701, #702, #703; validation code alignment follow-up tracked)
- [x] **N2. storage-adapter.md — REWRITE as current-state reference** — factory + providers documented, legacy shim deleted — ✅ DONE
- [x] **N3. blockchain.md — SPLIT + REWRITE** — ChainAdapter migration plan, polling indexer marked EXISTS — ✅ DONE
- [x] **N4. telemetry-pipeline.md — UPDATE** — thresholds section documents org-threshold routing, `detectTelemetryAnomalies` documented — ✅ DONE (#571)
- [ ] **N5. auth-model.md — UPDATE**: DRIVER role, persona claim, Sessions, 2FA, register-company, token-TTL table — Follow-up tracked in Phase 8
- [x] **N6. websockets.md — UPDATE**: raw-JWT example, 9-status enum, `notification:new` marked dead, SSE fan-out § — ✅ DONE
- [ ] **N7. environment-variables.md — UPDATE**: TOTP_ENCRYPTION_KEY, Cloudinary trio, active STORAGE_PROVIDER matrix — Follow-up tracked in Phase 8
- [x] **N8. DATABASE.md — UPDATE**: Migrations §, index coverage, text-index trackingNumber, dataHash note — ✅ DONE
- [x] **N9. PAGINATION.md — UPDATE**: users dual-mode live, payments total meta documented, shipment timeline row — ✅ DONE

### O. Root docs & conventions

- [ ] **O2. CHANGELOG.md — minor**: collapse consecutive `### Changed` headings — Follow-up tracked in Phase 8
- [x] **O3. AGENTS.md §7 — add chain-port boundary row** — ✅ DONE
- [ ] **O4. Husky decision** — ensure `.husky/pre-commit` fires or remove unused configs — Follow-up tracked in Phase 8
