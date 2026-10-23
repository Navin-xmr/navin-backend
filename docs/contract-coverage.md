# Contract Matrix Coverage — AGENTS §4 Gap Backfill (P5-05)

Source: `AGENTS.md` §4 — every endpoint must have 200 / 401 / 403 / 400-422 coverage.
Generated: 2026-09-25 from existing suites.

## Gap table (route × status → suite)

| Route | 200 | 401 | 403 | 400/422 | Notes / Waiver |
|-------|-----|-----|-----|---------|----------------|
| `GET /api/users` (users.list) | `users.list.controller.test.ts` | **MISSING** → added `users.list.missing-401.test.ts` | `requireRole.test.ts` | `users.validation` | 401 was missing - added |
| `PATCH /api/organizations/:id` | `organizations.test.ts` (200) | **MISSING** → added | 403 in `rbac.matrix` | 400 in `organizations.test.ts` | 401 added, 404 waived (org not found returns 403 per current authz) |
| `DELETE /api/organizations/:id` | `organizations.test.ts` (200) | **MISSING** → added | 403 in `rbac.matrix` | 400 in `organizations.test.ts` | 401 added |
| `POST /api/shipments/:id/proof` | `shipments.uploadProof.controller.test.ts` (201) | **MISSING** - no 401/403 anywhere | **MISSING** | 400 in `shipments.uploadProof` | Added 401 + 403 suites |
| `POST /api/shipments` (create) | `shipments.test.ts` (201) | present | **MISSING** 403 | 400 in `shipments.validation` | Added 403 (VIEWER cannot create - requires CREATOR) |
| `POST /api/companies/:id/api-keys` (company api-key) | `apiKey.service.test.ts` | present | 403 in `rbac.matrix` | **MISSING** 400 invalid-body | Added 400 (missing name/scope) |

## New `it()` blocks (count: 9)

- `tests/users.list.missing-401.test.ts` — 1 it: `GET /api/users without token → 401`
- `tests/organizations.missing-401.test.ts` — 2 it: `PATCH` + `DELETE` without token → 401
- `tests/shipments.proof.missing-auth.test.ts` — 2 it: `POST /proof` without token → 401, with VIEWER → 403
- `tests/shipments.create.missing-403.test.ts` — 1 it: `POST /api/shipments` as VIEWER → 403
- `tests/company-api-keys.missing-400.test.ts` — 3 it: `POST /api/companies/:id/api-keys` missing name/scope/ invalid scope → 400

All reuse helpers from `tests/helpers/mocks.ts` + `tests/fixtures/factories.ts` (real ObjectIds), no hand-rolled mocks. See `G-series` pattern.

## Verification

- `npm run lint` → 0 errors (new tests follow existing patterns, no `any`)
- `npm run typecheck` → 0 errors
- New suites: `npm test -- tests/users.list.missing-401.test.ts tests/organizations.missing-401.test.ts tests/shipments.proof.missing-auth.test.ts tests/shipments.create.missing-403.test.ts tests/company-api-keys.missing-400.test.ts` → all green
- Full suite delta: +9 passing, 0 new failures (baseline red tracked in TODO.md Part 1 unchanged)
