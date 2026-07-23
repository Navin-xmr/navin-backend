## [Unreleased]

### Fixed
- Replaced `new Error()` with `AppError` in `anomaly.service.ts`, `shipments.service.ts`, and standardised error codes in `telemetry.service.ts` / `iot.service.ts` (#257, #258, #255).
- Corrected Swagger response envelope for `GET /api/anomalies` and `PATCH /api/anomalies/{id}/resolve` to match the standard `{ success, message, data, meta? }` shape (#256, #299).

### Changed
- Removed `any` types from `analytics.service.ts`, `telemetry.service.ts`, `shipments.controller.ts`, and `users.model.ts`.

### Removed
- Archived `AUDIT_REPORT_*.html` files outside the repository for the current session.
- Deleted stale scrapes / snapshots: `navinmxv`, `Issues.md`, `md`, `documentation md`, and the `issues/` directory (#56–#65).

### Added
- Added regression test for resolving a non-existent anomaly (#299).
