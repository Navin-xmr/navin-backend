# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
- Corrected Swagger response envelope for `GET /api/anomalies` and `PATCH /api/anomalies/{id}/resolve` to match the standard `{ success, message, data, meta? }` shape (#256, #299).
- Removed `any` types from `analytics.service.ts`, `telemetry.service.ts`, `shipments.controller.ts`, and `users.model.ts`.

### Fixed

- Repaired merge-corrupted `src/config/index.ts` and duplicate keys in `src/env.ts` so `npm run build` succeeds (#396)
- Restored missing `organizationsRouter` import in `buildApp` and repaired broken `auth.controller` / Swagger YAML so pagination and search suites can boot
- Confirmed telemetry pagination and battery-threshold anomaly tests assert auth + `data` array envelope correctly

### Security

- Required `x-stellar-signature` on `POST /api/webhooks/stellar` and verified HMAC-SHA256 against `STELLAR_WEBHOOK_SECRET`
- Added inline security comments explaining critical design decisions (using `// SECURITY: [Threat] — This prevents [attack] by [mechanism]` pattern):
  - In `src/shared/middleware/requireAuth.ts` (Bearer formatting, JTI token tracking/revocation checks) (#311)
  - In `src/shared/middleware/verifyStellarSignature.ts` (timingSafeEqual for preventing side-channel attacks) (#311)
  - In `src/modules/users/users.service.ts` (placeholder high-entropy random hashes) (#311)
  - In `src/modules/auth/auth.service.ts` (TTL token expiration, JTI UUID generation) (#311)

### Removed

- Archived `AUDIT_REPORT_*.html` files outside the repository for the current session.
- Deleted stale scrapes / snapshots: `navinmxv`, `Issues.md`, `md`, `documentation md`, and the `issues/` directory (#56–#65).
