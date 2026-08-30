# Auth Model — Roles, Personas & JWT Claims

Reference for how Navin Backend authentication and authorization work today, and how they map (and currently diverge) from the frontend persona model described in `backend-integration-requirements.md`.

> **Source of truth for enforcement:** `src/shared/constants/roles.ts`, JWT issuance in `src/modules/auth/auth.service.ts`, and `requireRole(...)` on route files. This document is documentation-only.

---

## JWT claim shape

Authenticated requests use `Authorization: Bearer <token>`. Access tokens include:

| Claim | Type | Required | Description |
|-------|------|----------|-------------|
| `userId` | string | yes | Authenticated user MongoDB ObjectId |
| `role` | string (`UserRole`) | yes | Backend RBAC role (see below) |
| `organizationId` | string | no | User's organization ObjectId when assigned |
| `organizationType` | string (`ENTERPRISE` \| `LOGISTICS`) | no | Resolved from the organization at login/signup/refresh |
| `jti` | string (UUID) | yes | Unique token id used for logout / blocklist revocation |
| `exp` / `iat` | number | yes | Standard JWT expiry / issued-at (7-day TTL) |

These claims are documented on the OpenAPI `bearerAuth` security scheme in `docs/swagger.yaml`. See also Swagger UI at `/api-docs` (non-production).

---

## Backend roles (`UserRole`)

Defined in `src/shared/constants/roles.ts`:

| Role | Intended purpose |
|------|------------------|
| `SUPER_ADMIN` | Platform operator — organization CRUD, cross-org access, elevated admin actions |
| `ADMIN` | Organization administrator — users, API keys, payments, most write operations |
| `MANAGER` | Operational lead — shipments, anomalies, analytics, settlements dispute |
| `VIEWER` | Read-oriented org member — list/read shipments, ledger, templates, thresholds |
| `CUSTOMER` | End-customer / receiver persona on the backend enum — **rarely granted route access today** |

### Organization types

| `organizationType` | Meaning |
|--------------------|---------|
| `ENTERPRISE` | Shipper / enterprise customer org |
| `LOGISTICS` | Carrier / logistics provider org |

`organizationType` is a JWT claim, not a substitute for `role`. Route guards primarily check `role` via `requireRole`.

---

## Frontend personas vs backend roles

The frontend (`backend-integration-requirements.md` §3.3) uses a **two-level** model:

1. **Top-level account personas:** `company` | `customer`
2. **Company-internal RBAC:** `Admin` | `Manager` | `Viewer` | `Driver`

The backend uses a **flat** `UserRole` enum plus optional `organizationType`. There is **no** `company` / `customer` JWT role value today.

### Mapping table

| Frontend concept | Backend equivalent | Notes |
|------------------|--------------------|-------|
| Persona `company` | User with `organizationType` `ENTERPRISE` or `LOGISTICS`, typically `ADMIN` / `MANAGER` / `VIEWER` / `SUPER_ADMIN` | Not encoded as a JWT `role` value |
| Persona `customer` | `CUSTOMER` role (and/or enterprise-facing users) | Frontend expects persona in the token; backend stores `CUSTOMER` as a role |
| Role `Admin` | `ADMIN` | Case differs (`Admin` vs `ADMIN`) |
| Role `Manager` | `MANAGER` | |
| Role `Viewer` | `VIEWER` | Public signup defaults to `VIEWER` |
| Role `Driver` | *(none)* | **Not implemented** on the backend enum or routes |
| *(n/a)* | `SUPER_ADMIN` | Platform-only; no frontend persona equivalent |

### Known alignment gaps (pending)

1. **Driver role** — Frontend expects `Driver` for field operations; backend has no `DRIVER` / `Driver` value and no driver-scoped routes.
2. **Persona-in-JWT** — Frontend guidance asks for top-level `company` / `customer` in the token; backend issues `role` as `SUPER_ADMIN` \| `ADMIN` \| `MANAGER` \| `VIEWER` \| `CUSTOMER` and puts org kind in `organizationType`.
3. **CUSTOMER permissions** — `CUSTOMER` exists in the enum and invitation allow-lists, but almost no `requireRole(...)` lists include it, so customers are effectively locked out of most protected APIs until routes are aligned.
4. **Naming** — Frontend title-case (`Admin`) vs backend SCREAMING_SNAKE (`ADMIN`).

Until alignment work lands, clients should treat **backend `UserRole` + `organizationType`** as authoritative for API authorization.

---

## Permission matrix

Legend: **Y** = allowed by at least one matching route guard · **—** = not granted by current `requireRole` lists · **\*** = `requireAuth` only (any valid JWT role)

| Capability / area | SUPER_ADMIN | ADMIN | MANAGER | VIEWER | CUSTOMER |
|-------------------|:-----------:|:-----:|:-------:|:------:|:--------:|
| Auth — logout / refresh | Y | Y | Y | Y | Y |
| Users — `GET /me` | Y* | Y* | Y* | Y* | Y* |
| Users — list | Y | Y | Y | — | — |
| Users — create / team / invite / delete | Y | Y | — | — | — |
| API keys — create / list / revoke | Y | Y | — | — | — |
| Organizations — create / list / delete | Y | — | — | — | — |
| Organizations — get / update | Y | Y | — | — | — |
| Shipments — list / timeline | —† | Y | Y | Y | — |
| Shipments — get by id | Y | Y | Y | Y | — |
| Shipments — create / update / status / proof / docs / photos / disputes / delete / export | — | Y | Y | — | — |
| Shipments — ETA | Y* | Y* | Y* | Y* | Y* |
| Shipment templates — read | — | Y | Y | Y | — |
| Shipment templates — write / delete | — | Y | Y | — | — |
| Telemetry — list / bulk ingest | Y* | Y* | Y* | Y* | Y* |
| Telemetry — read thresholds | Y | Y | Y | Y | — |
| Telemetry — update thresholds | Y | Y | — | — | — |
| Anomalies — list / stats / resolve | — | Y | Y | — | — |
| Analytics — performance | — | Y | Y | — | — |
| Payments — list / get / summary | Y* | Y* | Y* | Y* | Y* |
| Payments — create / status update | Y | Y | — | — | — |
| Payments — dispute settlement | — | Y | Y | — | — |
| Ledger — list / get block | — | Y | Y | Y | — |
| Audit logs — list | Y | Y | — | — | — |

† `GET /api/shipments` allows `ADMIN` \| `MANAGER` \| `VIEWER` only (no `SUPER_ADMIN` on that guard); `GET /api/shipments/:id` does include `SUPER_ADMIN`.

Public (no JWT): health, signup, login, forgot/reset password, invitation verify/accept, IoT webhook (`x-api-key`), Stellar webhook (`x-stellar-signature`).

---

## Invitation role rules

When inviting users (`users.service`):

- `SUPER_ADMIN` may invite: `ADMIN`, `MANAGER`, `VIEWER`, `CUSTOMER`
- `ADMIN` may invite: `MANAGER`, `VIEWER`, `CUSTOMER`
- Neither may invite another `SUPER_ADMIN` via the normal invitation path

---

## Related docs

- OpenAPI security scheme: `docs/swagger.yaml` → `components.securitySchemes.bearerAuth`
- Frontend contract expectations: `backend-integration-requirements.md` §3 (Auth) and §3.3 (Role Model)
- Error codes for auth failures: `docs/ERROR_CODES.md` (`ERR_AUTH_INVALID`, `ERR_PERMISSION_DENIED`)
