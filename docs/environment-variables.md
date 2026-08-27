# Environment variable matrix

Single reference for every environment variable the Navin Backend reads or expects.
Cross-check source: `src/env.ts`, `.env.example`, and `process.env` / `env.*` usages under `src/`.

| Legend | Meaning |
|--------|---------|
| **Validated** | Present in the Zod schema in `src/env.ts` |
| **`.env.example`** | Listed in `.env.example` |
| **Used in code** | Read via `env` / `config` / `process.env` outside the schema itself |
| **Required** | Process will not start (or core flows fail) without a valid value |
| **Implementing issue** | Tracking issue for wiring or hardening a gap |

---

## Core runtime

| Variable | Validated | `.env.example` | Used in code | Required vs optional | Notes / implementing issue |
|----------|:---------:|:--------------:|:------------:|----------------------|----------------------------|
| `ALLOWED_ORIGINS` | yes | yes | yes | Optional (default `''`) | Comma-separated CORS allowlist (`src/config`) |
| `CORS_ORIGIN` | yes | yes | yes | Optional (default `*`) | Legacy single-origin CORS fallback |
| `JWT_SECRET` | yes | yes | yes | **Required** | Min 32 chars; auth tokens |
| `MONGO_URI` | yes | yes | yes | **Required** | Mongo connection string |
| `NODE_ENV` | yes | yes | yes | Optional (default `development`) | `development` \| `test` \| `production` |
| `PORT` | yes | yes | yes | Optional (default `3000`) | HTTP listen port |
| `REDIS_URL` | yes | yes | yes | Optional (default `redis://127.0.0.1:6379`) | BullMQ / SSE / caches |

## Stellar

| Variable | Validated | `.env.example` | Used in code | Required vs optional | Notes / implementing issue |
|----------|:---------:|:--------------:|:------------:|----------------------|----------------------------|
| `STELLAR_NETWORK` | yes | yes | yes | Optional (default `testnet`) | `testnet` \| `public`; selects the default Horizon/Soroban URLs (`src/config/stellarNetwork.ts`, implementing [#360](https://github.com/Navin-xmr/navin-backend/issues/360)); an unrecognized value fails fast at boot |
| `HORIZON_URL` | yes | no | yes | Optional — overrides the URL `STELLAR_NETWORK` derives | `src/services/stellar.service.ts` via `config.horizonUrl` |
| `STELLAR_SECRET_KEY` | yes | yes | yes | Optional at boot; **required** for anchoring/signing | Horizon/SDK workers (`src/services/stellar.service.ts`) |
| `STELLAR_WEBHOOK_SECRET` | yes | yes | yes | Optional at boot; **required** for webhook HMAC | `verifyStellarSignature` middleware |

## Frontend & email

| Variable | Validated | `.env.example` | Used in code | Required vs optional | Notes / implementing issue |
|----------|:---------:|:--------------:|:------------:|----------------------|----------------------------|
| `FRONTEND_URL` | yes | yes | yes | Optional (default `http://localhost:3000`) | Invite / password-reset links |
| `SENDGRID_API_KEY` | yes | yes | yes | Optional | Prefer SendGrid SMTP relay when set (`src/services/email.service.ts`) |
| `SMTP_FROM` | yes | yes | yes | Optional | From-address for outbound mail |
| `SMTP_HOST` | yes | yes | yes | Optional | Direct SMTP transport when SendGrid unset |
| `SMTP_PASS` | yes | yes | yes | Optional | SMTP password |
| `SMTP_PORT` | yes | yes | yes | Optional (default `587`) | SMTP port |
| `SMTP_USER` | yes | yes | yes | Optional | SMTP username |

> **SMTP status:** Schema + transport are implemented. Delivery still depends on providing credentials in each environment. Notifications product work is [#362](https://github.com/Navin-xmr/navin-backend/issues/362) / [#363](https://github.com/Navin-xmr/navin-backend/issues/363).

## Twilio (SMS) — TODO gap

| Variable | Validated | `.env.example` | Used in code | Required vs optional | Notes / implementing issue |
|----------|:---------:|:--------------:|:------------:|----------------------|----------------------------|
| `TWILIO_FROM` | yes | yes | no (config only) | Optional | **TODO** — exposed on `config.twilio` but no SMS client yet. [#364](https://github.com/Navin-xmr/navin-backend/issues/364) |
| `TWILIO_SID` | yes | yes | no (config only) | Optional | **TODO** — same as above |
| `TWILIO_TOKEN` | yes | yes | no (config only) | Optional | **TODO** — same as above |

## S3 / object storage — TODO gap

| Variable | Validated | `.env.example` | Used in code | Required vs optional | Notes / implementing issue |
|----------|:---------:|:--------------:|:------------:|----------------------|----------------------------|
| `S3_ACCESS_KEY` | yes | yes | no (config only) | Optional | **TODO** — uploads still use mock storage. [#379](https://github.com/Navin-xmr/navin-backend/issues/379) |
| `S3_BUCKET` | yes | yes | no (config only) | Optional | **TODO** — see `docs/storage-adapter.md` |
| `S3_ENDPOINT` | yes | yes | no (config only) | Optional | **TODO** — MinIO / R2 compatible endpoint |
| `S3_REGION` | yes | yes | no (config only) | Optional | **TODO** |
| `S3_SECRET_KEY` | yes | yes | no (config only) | Optional | **TODO** |
| `STORAGE_BUCKET` | no | no | no | Optional (planned) | **TODO** — documented in storage adapter; not in `env.ts` yet. [#379](https://github.com/Navin-xmr/navin-backend/issues/379) |
| `STORAGE_PROVIDER` | no | no | no | Optional (planned) | **TODO** — `mock` \| `s3` \| `cloudinary`. [#379](https://github.com/Navin-xmr/navin-backend/issues/379) |

## Soroban / escrow — TODO gap

| Variable | Validated | `.env.example` | Used in code | Required vs optional | Notes / implementing issue |
|----------|:---------:|:--------------:|:------------:|----------------------|----------------------------|
| `ESCROW_CONTRACT_ID` | yes | yes | no (config only) | Optional | **TODO** — no Soroban client yet. [#358](https://github.com/Navin-xmr/navin-backend/issues/358) |
| `SOROBAN_RPC_URL` | yes | yes | no (config only) | Optional | **TODO** — same as above |

## Observability

| Variable | Validated | `.env.example` | Used in code | Required vs optional | Notes / implementing issue |
|----------|:---------:|:--------------:|:------------:|----------------------|----------------------------|
| `LOG_LEVEL` | no | yes | yes | Optional | Read directly in `src/shared/logger/logger.ts` (not Zod-validated) |
| `SENTRY_DSN` | yes | yes | no (config only) | Optional | **TODO** — validated and on `config.sentryDsn`, but Sentry SDK is not initialized |

---

## Summary of gaps

| Gap area | Vars | Status | Implementing issue |
|----------|------|--------|--------------------|
| SMTP / email | `SMTP_*`, `SENDGRID_API_KEY` | Implemented (optional credentials) | — / notifications [#362](https://github.com/Navin-xmr/navin-backend/issues/362) |
| Twilio SMS | `TWILIO_*` | Schema + config only | [#364](https://github.com/Navin-xmr/navin-backend/issues/364) |
| S3 storage | `S3_*`, planned `STORAGE_*` | Schema + config only; mock uploads | [#379](https://github.com/Navin-xmr/navin-backend/issues/379) |
| Soroban escrow | `SOROBAN_RPC_URL`, `ESCROW_CONTRACT_ID` | Schema + config only | [#358](https://github.com/Navin-xmr/navin-backend/issues/358) |
| Sentry | `SENTRY_DSN` | Schema + config only | TBD (no dedicated issue yet) |

---

## Cross-check checklist

Every `env.*` / `process.env.*` name under `src/` should appear above:

- [x] `ALLOWED_ORIGINS`, `CORS_ORIGIN`, `JWT_SECRET`, `MONGO_URI`, `NODE_ENV`, `PORT`, `REDIS_URL`
- [x] `STELLAR_NETWORK`, `HORIZON_URL`, `STELLAR_SECRET_KEY`, `STELLAR_WEBHOOK_SECRET`
- [x] `FRONTEND_URL`, `SENDGRID_API_KEY`, `SMTP_*`
- [x] `TWILIO_*`, `S3_*`, `SOROBAN_RPC_URL`, `ESCROW_CONTRACT_ID`, `SENTRY_DSN`
- [x] `LOG_LEVEL` (unvalidated)
