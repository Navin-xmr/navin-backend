# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Created `docs/DATABASE.md` documenting plugin architecture, index optimization strategies, and schema conventions (#309)
- Created `src/shared/plugins/softDeletePlugin.ts` as a reusable Mongoose plugin for soft deletion (#309)

### Changed

- Updated `docs/swagger.yaml` to decouple request bodies from full response models for shipment routes:
  - Created `CreateShipmentRequest` for `POST /api/shipments` (#310)
  - Created `UploadProofRequest` for `POST /api/shipments/:id/proof` (#310)
  - Created `UpdateShipmentStatusRequest` for `PATCH /api/shipments/:id/status` (#310)
- Refined JSDoc header in `src/shared/plugins/isoDatePlugin.ts` (#309)

### Security

- Added inline security comments explaining critical design decisions (using `// SECURITY: [Threat] — This prevents [attack] by [mechanism]` pattern):
  - In `src/shared/middleware/requireAuth.ts` (Bearer formatting, JTI token tracking/revocation checks) (#311)
  - In `src/shared/middleware/verifyStellarSignature.ts` (timingSafeEqual for preventing side-channel attacks) (#311)
  - In `src/modules/users/users.service.ts` (placeholder high-entropy random hashes) (#311)
  - In `src/modules/auth/auth.service.ts` (TTL token expiration, JTI UUID generation) (#311)
