# Auth Model — Roles, Personas & JWT Claims

Reference for how Navin Backend authentication and authorization work today, and how they map to the frontend persona model described in `backend-integration-requirements.md`.

> **Source of truth for enforcement:** `src/shared/constants/roles.ts`, JWT issuance in `src/modules/auth/auth.service.ts`, and `requireRole(...)` on route files. This document is documentation-only.

---

## JWT claim shape

Authenticated requests use `Authorization: Bearer <token>`. Access tokens include:

| Claim | Type | Required | Description |
|-------|------|----------|-------------|
| `userId` | string | yes | Authenticated user MongoDB ObjectId |
| `role` | string (`UserRole`) | yes | Backend RBAC role (see below) |
| `persona` | string (`company` \| `customer`) | no | Derived top-level persona (`customer` for `CUSTOMER` role or `ENTERPRISE` org, `company` otherwise) |
| `organizationId` | string | no | User's organization ObjectId when assigned |
| `organizationType` | string (`ENTERPRISE` \| `LOGISTICS`) | no | Resolved from the organization at login/signup/refresh |
| `jti` | string (UUID) | yes | Unique token id used for logout / session tracking / blocklist revocation |
| `exp` / `iat` | number | yes | Standard JWT expiry / issued-at (7-day TTL) |

These claims are documented on the OpenAPI `bearerAuth` security scheme in `docs/swagger.yaml`. See also Swagger UI at `/api-docs` (non-production).

---

## Backend roles (`UserRole`)

Defined in `src/shared/constants/roles.ts` (and re-exported via `src/modules/users/users.model.ts` / `src/modules/invitations/invitations.service.ts`):

| Role | Intended purpose |
|------|------------------|
| `SUPER_ADMIN` | Platform operator — organization CRUD, cross-org access, elevated admin actions |
| `ADMIN` | Organization administrator — users, API keys, payments, most write operations |
| `MANAGER` | Operational lead — shipments, anomalies, analytics, settlements dispute |
| `DRIVER` | Field / carrier operator — invited under logistics or enterprise organizations for shipment execution and authenticated endpoints |
| `VIEWER` | Read-oriented org member — list/read shipments, activity feed, ledger, templates, thresholds |
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

The backend uses a **flat** `UserRole` enum plus `persona` and optional `organizationType`.

### Mapping table

| Frontend concept | Backend equivalent | Notes |
|------------------|--------------------|-------|
| Persona `company` | `persona: 'company'` (typically `ADMIN` / `MANAGER` / `DRIVER` / `VIEWER` / `SUPER_ADMIN` in `LOGISTICS` orgs) | Derived automatically when issuing JWTs in `auth.service.ts` |
| Persona `customer` | `persona: 'customer'` (`CUSTOMER` role or `ENTERPRISE` `organizationType`) | Derived automatically when issuing JWTs in `auth.service.ts` |
| Role `Admin` | `ADMIN` | Case differs (`Admin` vs `ADMIN`) |
| Role `Manager` | `MANAGER` | |
| Role `Driver` | `DRIVER` | Live in `UserRole.DRIVER` (`src/shared/constants/roles.ts`) and invitation allow-lists |
| Role `Viewer` | `VIEWER` | Public signup defaults to `VIEWER` |
| *(n/a)* | `SUPER_ADMIN` | Platform-only; no frontend persona equivalent |

### Known alignment gaps (pending)

1. **Driver route scoping** — `UserRole.DRIVER` is defined on the backend enum and supported in user/company invitations and user filtering, though dedicated driver-only shipment mutation guards are still pending route-level rollout.
2. **CUSTOMER permissions** — `CUSTOMER` exists in the enum and invitation allow-lists, but almost no `requireRole(...)` lists include it, so customers are effectively locked out of most protected APIs until routes are aligned.
3. **Naming** — Frontend title-case (`Admin`, `Driver`) vs backend SCREAMING_SNAKE (`ADMIN`, `DRIVER`).

Until full route alignment lands, clients should treat **backend `UserRole` + `organizationType`** as authoritative for API authorization.

---

## Permission matrix

Legend: **Y** = allowed by at least one matching route guard · **—** = not granted by current `requireRole` lists · **\*** = `requireAuth` only (any valid JWT role)

| Capability / area | SUPER_ADMIN | ADMIN | MANAGER | DRIVER | VIEWER | CUSTOMER |
|-------------------|:-----------:|:-----:|:-------:|:------:|:------:|:--------:|
| Auth — logout / refresh / password / 2FA / sessions | Y* | Y* | Y* | Y* | Y* | Y* |
| Users — `GET /me`, `PATCH /me`, `DELETE /me` | Y* | Y* | Y* | Y* | Y* | Y* |
| Users — list | Y | Y | Y | — | — | — |
| Users — create / team / invite / delete | Y | Y | — | — | — | — |
| API keys — create / list / revoke | Y | Y | — | — | — | — |
| Organizations — create / list / delete | Y | — | — | — | — | — |
| Organizations — get / update | Y | Y | — | — | — | — |
| Shipments — list / timeline | —† | Y | Y | — | Y | — |
| Shipments — get by id | Y | Y | Y | — | Y | — |
| Shipments — create / update / status / proof / docs / photos / disputes / delete / export | — | Y | Y | — | — | — |
| Shipments — ETA | Y* | Y* | Y* | Y* | Y* | Y* |
| Shipment templates — read | — | Y | Y | — | Y | — |
| Shipment templates — write / delete | — | Y | Y | — | — | — |
| Telemetry — list / bulk ingest | Y* | Y* | Y* | Y* | Y* | Y* |
| Telemetry — read thresholds | Y | Y | Y | — | Y | — |
| Telemetry — update thresholds | Y | Y | — | — | — | — |
| Anomalies — list / stats / resolve | — | Y | Y | — | — | — |
| Analytics — performance | — | Y | Y | — | — | — |
| Payments — list / get / summary | Y* | Y* | Y* | Y* | Y* | Y* |
| Payments — create / status update | Y | Y | — | — | — | — |
| Payments — dispute settlement | — | Y | Y | — | — | — |
| Ledger — list / get block | — | Y | Y | — | Y | — |
| Audit logs / Activity — `GET /api/activity` | Y | Y | Y | — | Y | — |
| Audit logs (legacy) — `GET /api/audit-logs` | Y | Y | — | — | — | — |

† `GET /api/shipments` allows `ADMIN` \| `MANAGER` \| `VIEWER` only (no `SUPER_ADMIN` on that guard); `GET /api/shipments/:id` does include `SUPER_ADMIN`.
‡ `src/modules/audit-logs/auditLogs.routes.ts` mounts `activityRouter` (`GET /api/activity`) with `requireRole(UserRole.ADMIN, UserRole.MANAGER, UserRole.VIEWER, UserRole.SUPER_ADMIN)` so `VIEWER` can read organization activity/audit feeds, while the legacy `GET /api/audit-logs` router restricts access to `SUPER_ADMIN` and `ADMIN`.

Public (no JWT): health, signup, login, company registration, forgot/reset password, invitation verify/accept, public shipment tracking, IoT webhook (`x-api-key`), Stellar webhook (`x-stellar-signature`).

---

## Invitation role rules

When inviting users (`users.service` and `invitations.service`):

- `SUPER_ADMIN` may invite: `ADMIN`, `MANAGER`, `DRIVER`, `VIEWER`, `CUSTOMER`
- `ADMIN` may invite: `MANAGER`, `DRIVER`, `VIEWER`, `CUSTOMER`
- Neither may invite another `SUPER_ADMIN` via the normal invitation path

---

## TOTP Two-Factor Authentication (`/api/auth/2fa/*`)

Authenticated users (any role with a valid JWT via `requireAuth`) can enroll in Time-based One-Time Password (TOTP) 2FA implemented in `src/modules/auth/twoFactor.controller.ts` and `src/modules/auth/twoFactor.service.ts`:

| Endpoint | Auth | Description |
|----------|------|-------------|
| `POST /api/auth/2fa/setup` | `requireAuth` | Generates a pending TOTP secret (`otplib`) and returns `{ otpauthUrl, secret }` for QR code rendering (`issuer: 'Navin'`). Does **not** activate 2FA until verified. Returns `409 TOTP_ALREADY_ENABLED` if already active. |
| `POST /api/auth/2fa/verify` | `requireAuth` | Validates a 6-digit TOTP `code` against the pending secret, sets `totpEnabled: true`, stores 10 bcrypt-hashed backup codes on the user document, and returns the 10 plaintext single-use `{ backupCodes }` once. |
| `DELETE /api/auth/2fa` | `requireAuth` | Verifies the caller's current `password` and disables 2FA (`totpEnabled: false`, clears `totpSecret` and `totpBackupCodes`). |
| `POST /api/auth/2fa/backup-codes/regenerate` | `requireAuth` | Invalidates existing backup codes and issues 10 fresh single-use `{ backupCodes }` (requires `totpEnabled: true`). |

### Login with 2FA

- When `user.totpEnabled` is `true`, `POST /api/auth/login` requires a valid TOTP code or a single-use 10-hex-character backup code (`consumeBackupCode`).
- Backup codes are hashed with bcrypt at rest and removed immediately upon consumption.

---

## Session Management & Refresh Lifecycle (`/api/auth/sessions/*` / `/api/sessions/*`)

Session tracking and token revocation are implemented in `src/modules/auth/session.model.ts`, `src/modules/auth/session.service.ts`, and `src/modules/auth/session.controller.ts`:

### Session Persistence & Token JTI

- Every JWT issued during signup, login, or token refresh (`POST /api/auth/refresh`) includes a unique UUID `jti` (7-day TTL).
- On signup and login, `createSession({ userId, jti, ip, userAgent })` records an active session document in MongoDB (`SessionModel`) keyed by `jti` and `userId`.
- On `POST /api/auth/refresh`, the incoming token is verified against the Redis token blocklist (`isTokenBlocked(jti)`), its `jti` is blocklisted in Redis (`blockToken`), and a fresh JWT with a new `jti` is issued.

### Session Endpoints

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /api/auth/sessions` | `requireAuth` | Lists all active sessions for the authenticated user ordered by `createdAt` descending (`ip`, `userAgent`, `jti`, `createdAt`). (Also referenced as `/api/sessions` in client specs.) |
| `DELETE /api/auth/sessions/:jti` | `requireAuth` | Revokes a specific session by `jti`: verifies session ownership (`403 FORBIDDEN` if the session belongs to another user, `404 NOT_FOUND` if missing), adds `jti` to the Redis token blocklist (`blockToken`) for the 7-day token TTL so `requireAuth` rejects it immediately, and deletes the session document from MongoDB. |
| `POST /api/auth/logout` | `requireAuth` | Revokes the caller's current token by blocklisting its `jti` in Redis for the remaining TTL. |

---

## Related docs

- OpenAPI security scheme: `docs/swagger.yaml` → `components.securitySchemes.bearerAuth`
- Frontend contract expectations: `backend-integration-requirements.md` §3 (Auth) and §3.3 (Role Model)
- Error codes for auth failures: `docs/ERROR_CODES.md` (`ERR_AUTH_INVALID`, `ERR_PERMISSION_DENIED`)
