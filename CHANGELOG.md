# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

**Phase 6 — Hash-and-Emit chain architecture**

- `ChainAdapter` port (`src/services/chain/types.ts`) with `anchorEvent`, `releaseEscrow`, `streamEvents` and the `AnchorResult` / `EscrowResult` / `ChainEvent` shapes; domain modules may depend on the port and the factory only, never on an adapter implementation or the Stellar SDK (#650).
- `SimulatedAdapter` (`src/services/chain/simulated.adapter.ts`) — Horizon `manageData` anchors and releases with `simulated: true` receipts; every result is explicitly flagged so demos never imply a real escrow (#650).
- `SorobanAdapter` (`src/services/chain/soroban.adapter.ts`) — live contract execution over Soroban RPC via `simulateTransaction` → `assembleTransaction` → sign → `sendTransaction` → poll, wired into `createChainAdapter()` (#656).
- Config-selected adapter factory `getChainAdapter()` / `createChainAdapter()` driven by the `SOROBAN_ADAPTER` env var (`simulated` | `soroban`), with `resetChainAdapter()` as a test seam (#653).
- `KeyedSerializer` (`src/services/chain/serializer.ts`) — per-signing-account serialization so concurrent anchor jobs never build against a stale sequence number (#653).
- Typed chain spec mirror (`src/shared/types/chain.ts`) with `.strict()` Zod schemas for functions, events and errors, `CHAIN_SPEC_VERSION = 1.0.0-draft`, the contract-error → `ERR_CHAIN_*` map and `parseChainEvent()` for indexer ingress (#651).
- `GET /api/ledger/blocks/:id/verification` returning `{ canonicalPayload, dataHash, txHash, transactionHash, ledger }` so a client can verify a block independently of the API (#665).
- `canonicalPayload` persisted on every `LedgerBlock` alongside its `dataHash`, so verifiers never have to re-guess which bytes were committed (#655).
- Golden cross-repo chain vectors in `tests/fixtures/chain/{functions,events,errors}.json` (`spec_version = 1.0.0-draft`), validated against the Zod schemas by `tests/indexer.golden.test.ts` (#666; shared with [navin-contracts](https://github.com/Navin-xmr/navin-contracts)).
- Chain alignment suites: `tests/chain.adapter.contract.test.ts` (dual-binding adapter contract) (#671), `tests/chain.signing-concurrency.test.ts` (sequencing safety gate) (#669) and the `fakeChainAdapter` port-only test double in `tests/helpers/` (#670).
- Chain spec documentation `docs/chain-interface.md` as the versioned source of truth for function, event and error shapes (#727 / #649).
- `dataHash` field on `LedgerBlock` plus its sparse index, added with a migration (#660).
- Client-side verification guide in `docs/blockchain.md`: the 3-step fetch → recompute `sha256(canonicalPayload)` → query Horizon/Soroban flow, with copy-pasteable Web Crypto snippets (#856).
- `docs/swagger.yaml` entry for `GET /api/ledger/blocks/:id/verification`, previously missing from the OpenAPI spec (#856).
- `SOROBAN_ADAPTER`, `SOROBAN_RPC_URL` and `ESCROW_CONTRACT_ID` env vars, with a `superRefine` rule requiring the latter two whenever `SOROBAN_ADAPTER=soroban` (#653).
- Storage provider selection: `STORAGE_PROVIDER` (`mock` | `s3` | `r2` | `cloudinary`) with `S3_*` and `CLOUDINARY_*` adapters behind the `StorageAdapter` contract.
- `TOTP_ENCRYPTION_KEY` (64 hex chars / AES-256-GCM) for encrypting TOTP secrets at rest, falling back to `sha256(JWT_SECRET)` when unset.

**Other**

- Added Docker Compose quickstart, service topology, environment-matrix pointer, and troubleshooting guidance to the README
- Added integration contract tests for implemented routes, authentication, role guards, and response envelopes (#385)
- Added test-runner documentation for the backend integration contract suite (#385)
- Renamed Socket.IO event `telemetry_update` → `location:update` to match frontend contract
- Renamed Socket.IO event `anomaly_detected` → `anomaly:detected` to match frontend contract
- Renamed Socket.IO event `status_update` → `shipment:status` to match frontend contract
- Renamed Socket.IO event `payment_status_changed` → `settlement:status`; added `txHash` field to carry Stellar transaction hash for on-chain transitions
- Added `emitNotificationNew()` emitter in `src/infra/socket/io.ts` for the new `notification:new` event targeted at user/organisation-scoped rooms
- Added `SettlementStatusPayload` and `NotificationPayload` interfaces to `src/shared/types/socketEvents.ts`; deprecated `PaymentStatusPayload` alias kept for backward compatibility
- Updated `docs/websockets.md` to document all renamed and new events with full payload schemas

### Changed

- Corrected `docs/PAGINATION.md` pagination strategy table: users dual-mode is live, documented the payments `total` meta variance, added shipment timeline to the cursor list (#576)
- Refactored `loginLimiter` in `src/shared/middleware/rateLimiter.ts` to reuse `createRateLimitHandler()`, removing the duplicated inline 429 handler (#815)

- Stellar writes moved behind the `ChainAdapter` port: `telemetry` / `payments` / `shipments` / `webhooks` and the workers now import `types.ts` + `getChainAdapter()` only, and no longer construct Horizon transactions directly (#650).
- `releaseEscrow()` manage-data marker replaced by a real `adapter.releaseEscrow()` delegation (#657).
- `stellar-indexer.worker.ts` rewritten to consume `adapter.streamEvents()` instead of inferring events from memo text (#662).
- `config.horizonUrl` (and the Soroban RPC URL) are now derived from `STELLAR_NETWORK` instead of being hard-coded, with `HORIZON_URL` / `SOROBAN_RPC_URL` as per-field overrides (#658).
- `LedgerBlock.eventType` replaced by the canonical `milestoneEvent` field, removing the dual-field split-brain; `eventType` is accepted on input but no longer persisted separately (#661).
- Status-change ledger blocks no longer reuse the creation-time `stellarTxHash` (#663).
- Chain shapes are imported only from `src/shared/types/chain.ts`; per AGENTS.md §8, any change to `docs/chain-interface.md` must land with a `CHAIN_SPEC_VERSION` bump and the matching `spec_version` bump in the golden fixtures — and vice versa.
- Test mocks for chain call sites are port-only (`fakeChainAdapter`); no test constructs a real adapter implementation (#670).

**Other**

- Added canonical `dataHash` persistence for shipment status, settlement, and proof ledger events (#654)
- Corrected `docs/PAGINATION.md` pagination strategy table: users dual-mode is live, documented the payments `total` meta variance, added shipment timeline to the cursor list (#576)
- Documented Horizon escrow fallback and Soroban integration plan in `docs/blockchain.md` (#395)
- Documented storage adapter contract in `docs/storage-adapter.md` and expanded JSDoc on `mockStorageService` (#397)
- Added `reports/generate-coverage.js` and `reports/API_SURFACE_COVERAGE.html` to detect swagger.yaml vs Express route drift (#399)
- Documented the telemetry ingestion pipeline as a Mermaid sequence diagram in `docs/telemetry-pipeline.md`, including BullMQ queue names (`transaction_queue`, `alert_queue`) and the 25/80 vs legacy 85/90 threshold note (#396)
- Expanded Swagger schemas for `POST /api/webhooks/iot` (union payload + 202 response) and `POST /api/webhooks/stellar` (#396)
- `GET /api/activity` — new activity feed endpoint accessible to ADMIN, MANAGER, and VIEWER roles with `before`-based ISO date pagination and `meta: { limit, total, hasMore, before }` envelope
- Expanded `AuditAction` type with 7 new variants: `SHIPMENT_CREATED`, `PROOF_UPLOADED`, `TELEMETRY_ANCHORED`, `SETTLEMENT_RELEASED`, `ANOMALY_DETECTED`, `USER_INVITED`, `DISPUTE_OPENED`
- `SHIPMENT_CREATED` audit log written from `createShipmentService` when a shipment is created
- `PROOF_UPLOADED` audit log written from `uploadShipmentProofService` when delivery proof is attached
- `DISPUTE_OPENED` audit log written from `createDisputeService` when a dispute is filed
- `SETTLEMENT_RELEASED` audit log written from `releasePaymentService` on escrow release
- `USER_INVITED` audit log written from `generateInvitationLink` after invitation token is issued
- `TELEMETRY_ANCHORED` audit log written from `updateTelemetryAnchor` when a telemetry record is anchored on Stellar
- `ANOMALY_DETECTED` audit log written from `detectAnomaly` per detected anomaly
- `ActivityEvent` OpenAPI schema added to `docs/swagger.yaml` with full action/resource enums
- Integration tests for `/api/activity` covering auth, role guards, mixed event types, `before` pagination, two-page cursor walk, and validation errors
- `/api/audit-logs` role guard retained as SUPER_ADMIN + ADMIN only (backward compat); new `/api/activity` opens VIEWER and MANAGER access
- `createShipmentService` now accepts optional `actorUserId` and strips it before Mongoose insert
- `uploadShipmentProofService` and `createDisputeService` accept optional `actorUserId` for audit attribution
- `releasePaymentService` accepts optional `actorUserId`; falls back to `'system'` for automated releases
- Audit pagination changed from cursor (`nextCursor`) to `before` (ISO date) on the new `/api/activity` endpoint for simpler frontend integration
- Added shared `PASSWORD_MIN_LENGTH` / `PASSWORD_MIN_LENGTH_MESSAGE` constants used by all password Zod schemas
- Added `STELLAR_WEBHOOK_SECRET` to `src/env.ts` and HMAC signature tests for `POST /api/webhooks/stellar`
- Added `docs/PAGINATION.md` and shared helpers in `src/shared/utils/pagination.ts` documenting cursor vs offset conventions
- Extended `GET /api/shipments` with `q`, `trackingNumber`, `from`/`to`, and multi-status filters plus text index on trackingNumber/origin/destination
- Created `docs/DATABASE.md` documenting plugin architecture, index optimization strategies, and schema conventions (#309)
- Created `src/shared/plugins/softDeletePlugin.ts` as a reusable Mongoose plugin for soft deletion (#309)
- Added regression test for resolving a non-existent anomaly (#299).
- `GET /api/events/poll` — polling fallback endpoint returning `RealtimeEvent[]` from a Redis-backed recent-events list (last 60 s window, capped at 500 entries); supports optional `since` ISO 8601 query param (#48)
- Standardized password `minLength` to 8 across auth and users validation schemas and Swagger
- Captured `req.rawBody` in the global JSON parser so Stellar webhook HMAC verification can sign the exact bytes received
- Telemetry rejects simultaneous `cursor` + `page`; cursor takes precedence; pagination meta stays in `meta`
- Anomaly and telemetry list services use shared `paginateCursor` helper
- Updated shipment search tests and Swagger query params for the new filters
- Updated `docs/swagger.yaml` to decouple request bodies from full response models for shipment routes:
  - Created `CreateShipmentRequest` for `POST /api/shipments` (#310)
  - Created `UploadProofRequest` for `POST /api/shipments/:id/proof` (#310)
  - Created `UpdateShipmentStatusRequest` for `PATCH /api/shipments/:id/status` (#310)
- Refined JSDoc header in `src/shared/plugins/isoDatePlugin.ts` (#309)
- Replaced `new Error()` with `AppError` in `anomaly.service.ts`, `shipments.service.ts`, and standardised error codes in `telemetry.service.ts` / `iot.service.ts` (#257, #258, #255).
- Corrected Swagger response envelope for `GET /api/anomalies` and `PATCH /api/anomalies/:id/resolve` to match the standard `{ success, message, data, meta? }` shape (#256, #299).
- Removed `any` types from `analytics.service.ts`, `telemetry.service.ts`, `shipments.controller.ts`, and `users.model.ts`.
- `docs/environment-variables.md` rewritten as a 1-to-1 mirror of `src/env.schema.ts`, documenting every variable's exact Zod rule, default and conditional requirement (#855).

### Removed

- Archived `AUDIT_REPORT_*.html` files outside the repository for the current session.
- Deleted stale scrapes / snapshots: `navinmxv`, `Issues.md`, `md`, `documentation md`, and the `issues/` directory (#56–#65).
- Dropped the stale `eventType` index from the `LedgerBlock` schema; the canonical `milestoneEvent` field is indexed instead.

### Fixed

- Restored per-account Stellar signing serialization and bounded `tx_bad_seq` retries (#692)
- Repaired merge-corrupted `src/config/index.ts` and duplicate keys in `src/env.ts` so `npm run build` succeeds (#396)
- Restored missing `organizationsRouter` import in `buildApp` and repaired broken `auth.controller` / Swagger YAML so pagination and search suites can boot
- Confirmed telemetry pagination and battery-threshold anomaly tests assert auth + `data` array envelope correctly
- Indexer writes the top-level `dataHash` onto `LedgerBlock` so verification material is populated from indexed events
- Indexer writes `milestoneEvent` instead of the legacy `eventType` field
- Added reusable user/organization query mocks and repository contract coverage (#748).
- Consolidated Socket.IO mock exports and checked every bulk telemetry broadcast payload (#746).
- Migrated list-users tests to shared ESM dependency mocks (#749).
- Isolated invitation tests from user/organization repositories and audit persistence (#750).

### Security

- Required `x-stellar-signature` on `POST /api/webhooks/stellar` and verified HMAC-SHA256 against `STELLAR_WEBHOOK_SECRET`
- Added inline security comments explaining critical design decisions (using `// SECURITY: [Threat] — This prevents [attack] by [mechanism]` pattern):
  - In `src/shared/middleware/requireAuth.ts` (Bearer formatting, JTI token tracking/revocation checks) (#311)
  - In `src/shared/middleware/verifyStellarSignature.ts` (timingSafeEqual for preventing side-channel attacks) (#311)
  - In `src/modules/users/users.service.ts` (placeholder high-entropy random hashes) (#311)
  - In `src/modules/auth/auth.service.ts` (TTL token expiration, JTI UUID generation) (#311)
