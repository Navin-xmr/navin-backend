# Environment variable matrix

Single reference for every environment variable the Navin Backend reads or expects.
Cross-check source: `src/env.schema.ts`, `src/env.ts`, `.env.example`, and `process.env` / `env.*` usages under `src/`.

| Legend | Meaning |
|--------|---------|
| **Validated** | Present in the Zod schema in `src/env.schema.ts` (`envSchema`) |
| **`.env.example`** | Listed in `.env.example` |
| **Used in code** | Read via `env` / `config` / `process.env` outside the schema itself |
| **Required** | Process will not start (or core flows fail) without a valid value |
| **Implementing issue** | Tracking issue or module wiring reference |

---

## Core runtime

| Variable | Validated | `.env.example` | Used in code | Required vs optional | Validation rule / notes |
|----------|:---------:|:--------------:|:------------:|----------------------|-------------------------|
| `ALLOWED_ORIGINS` | yes | yes | yes | Optional (default `''`) | `z.string().default('')` — Comma-separated CORS allowlist (`src/config`) |
| `CORS_ORIGIN` | yes | yes | yes | Optional (default `*`) | `z.string().default('*')` — Single-origin CORS fallback |
| `JWT_SECRET` | yes | yes | yes | **Required** | `z.string().trim().min(32)` — Min 32 chars; signs auth JWTs |
| `MONGO_URI` | yes | yes | yes | **Required** | `z.string().min(1).regex(/^mongodb(\+srv)?:\/\/.+$/)` — MongoDB connection URI |
| `NODE_ENV` | yes | yes | yes | Optional (default `development`) | `z.enum(['development', 'test', 'production']).default('development')` |
| `PORT` | yes | yes | yes | Optional (default `3000`) | `z.coerce.number().int().min(1).max(65535).default(3000)` — HTTP listen port |
| `REDIS_URL` | yes | yes | yes | Optional (default `redis://127.0.0.1:6379`) | `z.string().url()` starting with `redis://` or `rediss://` — BullMQ / SSE / caches |

## Authentication & TOTP 2FA

| Variable | Validated | `.env.example` | Used in code | Required vs optional | Validation rule / notes |
|----------|:---------:|:--------------:|:------------:|----------------------|-------------------------|
| `TOTP_ENCRYPTION_KEY` | yes | yes | yes | Optional at boot; **required** for TOTP 2FA | `z.string().trim().regex(/^[0-9a-fA-F]{64}$/).optional()` — Exactly 64 hex chars (32 bytes) AES-256-GCM key encrypting TOTP secrets at rest (`src/modules/auth/totp.service.ts`) |

## Stellar & Soroban / Escrow (`ChainAdapter`)

| Variable | Validated | `.env.example` | Used in code | Required vs optional | Validation rule / notes |
|----------|:---------:|:--------------:|:------------:|----------------------|-------------------------|
| `STELLAR_NETWORK` | yes | yes | yes | Optional (default `testnet`) | `z.enum(['testnet', 'public']).default('testnet')`; selects default Horizon/Soroban endpoints (`src/config/stellarNetwork.ts`) |
| `HORIZON_URL` | yes | yes | yes | Optional — overrides `STELLAR_NETWORK` derived URL | `z.string().url().optional()` (`src/services/stellar.service.ts`, `src/services/chain/`) |
| `STELLAR_SECRET_KEY` | yes | yes | yes | Optional at boot; **required** for anchoring/signing | `z.string().trim().regex(/^S[A-Z2-7]{20,}$/).optional()` — Stellar `S...` secret seed |
| `STELLAR_WEBHOOK_SECRET` | yes | yes | yes | Optional at boot; **required** for webhook HMAC | `z.string().trim().min(16).optional()` — `verifyStellarSignature` middleware |
| `SOROBAN_ADAPTER` | yes | yes | yes | Optional (default `simulated`) | `z.enum(['simulated', 'soroban']).default('simulated')` — Selects `SimulatedAdapter` vs `SorobanAdapter` in `src/services/chain/factory.ts` |
| `SOROBAN_RPC_URL` | yes | yes | yes | **Conditionally required** when `SOROBAN_ADAPTER=soroban` (`superRefine`); optional otherwise | `z.string().url().optional()` — Soroban JSON-RPC endpoint consumed by `SorobanAdapter` (`src/services/chain/soroban.adapter.ts`) |
| `ESCROW_CONTRACT_ID` | yes | yes | yes | **Conditionally required** when `SOROBAN_ADAPTER=soroban` (`superRefine`); optional otherwise | `z.string().min(1).optional()` — Deployed Soroban escrow/anchor contract ID consumed by `SorobanAdapter` |

### `ChainAdapter` & `superRefine` rules

| `SOROBAN_ADAPTER` | `SOROBAN_RPC_URL` & `ESCROW_CONTRACT_ID` | `STELLAR_SECRET_KEY` | Behaviour |
|-------------------|------------------------------------------|----------------------|-----------|
| unset / `simulated` | optional | set | `SimulatedAdapter`: Horizon manage-data anchors/releases (`simulated: true`) |
| unset / `simulated` | optional | unset | Adapter builds; chain writes reject with `ERR_CHAIN_UNKNOWN` (500) |
| `soroban` | **both required** (`superRefine`) | set | `SorobanAdapter`: invokes Soroban RPC + `ESCROW_CONTRACT_ID` for `anchor_event`, `init_escrow`, `release_escrow`, and `streamEvents` |
| `soroban` | either missing | any | `envSchema.superRefine` fails fast at boot with `SOROBAN_RPC_URL is required when SOROBAN_ADAPTER=soroban` / `ESCROW_CONTRACT_ID is required when SOROBAN_ADAPTER=soroban` |

## Object storage (`mock`, `s3`, `r2`, `cloudinary`)

| Variable | Validated | `.env.example` | Used in code | Required vs optional | Validation rule / notes |
|----------|:---------:|:--------------:|:------------:|----------------------|-------------------------|
| `STORAGE_PROVIDER` | yes | yes | yes | Optional (default `mock`) | `z.enum(['mock', 's3', 'r2', 'cloudinary']).default('mock')` — Selects active storage adapter (`src/services/storage/`) |
| `S3_BUCKET` | yes | yes | yes | Required when `STORAGE_PROVIDER` is `s3` or `r2` | `z.string().min(1).optional()` — Target S3 / Cloudflare R2 bucket name |
| `S3_ENDPOINT` | yes | yes | yes | Optional (required for R2 / MinIO) | `z.string().url().optional()` — S3-compatible endpoint URL |
| `S3_ACCESS_KEY` | yes | yes | yes | Required when `STORAGE_PROVIDER` is `s3` or `r2` | `z.string().min(1).optional()` — S3 access key ID |
| `S3_SECRET_KEY` | yes | yes | yes | Required when `STORAGE_PROVIDER` is `s3` or `r2` | `z.string().min(1).optional()` — S3 secret access key |
| `S3_REGION` | yes | yes | yes | Optional (default `us-east-1` / `auto` in adapter) | `z.string().min(1).optional()` — AWS S3 / R2 region |
| `CLOUDINARY_CLOUD_NAME` | yes | yes | yes | Required when `STORAGE_PROVIDER=cloudinary` | `z.string().min(1).optional()` — Cloudinary cloud name (`src/services/storage/cloudinary.storage.ts`) |
| `CLOUDINARY_API_KEY` | yes | yes | yes | Required when `STORAGE_PROVIDER=cloudinary` | `z.string().min(1).optional()` — Cloudinary API key |
| `CLOUDINARY_API_SECRET` | yes | yes | yes | Required when `STORAGE_PROVIDER=cloudinary` | `z.string().min(1).optional()` — Cloudinary API secret |

## Frontend & email (SMTP / SendGrid)

| Variable | Validated | `.env.example` | Used in code | Required vs optional | Validation rule / notes |
|----------|:---------:|:--------------:|:------------:|----------------------|-------------------------|
| `FRONTEND_URL` | yes | yes | yes | Optional (default `http://localhost:3000`) | `z.string().url().default('http://localhost:3000')` — Invite / password-reset links |
| `SENDGRID_API_KEY` | yes | yes | yes | Optional | `z.string().optional()` — SendGrid SMTP relay key (`src/services/email.service.ts`) |
| `SMTP_FROM` | yes | yes | yes | Optional | `z.string().email().optional()` — From-address for outbound mail |
| `SMTP_HOST` | yes | yes | yes | Optional | `z.string().min(1).optional()` — Direct SMTP host when SendGrid unset |
| `SMTP_PASS` | yes | yes | yes | Optional | `z.string().min(1).optional()` — SMTP password |
| `SMTP_PORT` | yes | yes | yes | Optional (default `587`) | `z.coerce.number().int().min(1).max(65535).default(587)` — SMTP port |
| `SMTP_USER` | yes | yes | yes | Optional | `z.string().min(1).optional()` — SMTP username |

## Twilio (SMS)

| Variable | Validated | `.env.example` | Used in code | Required vs optional | Validation rule / notes |
|----------|:---------:|:--------------:|:------------:|----------------------|-------------------------|
| `TWILIO_FROM` | yes | yes | yes | Optional | `z.string().min(1).optional()` — Outbound SMS sender number (`src/services/sms.service.ts`) |
| `TWILIO_SID` | yes | yes | yes | Optional | `z.string().min(1).optional()` — Twilio Account SID |
| `TWILIO_TOKEN` | yes | yes | yes | Optional | `z.string().min(1).optional()` — Twilio Auth Token |

## Observability

| Variable | Validated | `.env.example` | Used in code | Required vs optional | Validation rule / notes |
|----------|:---------:|:--------------:|:------------:|----------------------|-------------------------|
| `LOG_LEVEL` | no | yes | yes | Optional | Read directly in `src/shared/logger/logger.ts` (not in `envSchema`) |
| `SENTRY_DSN` | yes | yes | yes | Optional | `z.string().url().optional()` — Sentry error reporting DSN |

---

## Cross-check checklist (`src/env.schema.ts` 1-to-1 parity)

Every key in `src/env.schema.ts` (`envSchema`) appears above:

- [x] **Core**: `NODE_ENV`, `PORT`, `MONGO_URI`, `JWT_SECRET`, `ALLOWED_ORIGINS`, `REDIS_URL`, `CORS_ORIGIN`
- [x] **Auth / 2FA**: `TOTP_ENCRYPTION_KEY`
- [x] **Stellar & Soroban**: `STELLAR_SECRET_KEY`, `STELLAR_WEBHOOK_SECRET`, `STELLAR_NETWORK`, `HORIZON_URL`, `SOROBAN_ADAPTER`, `SOROBAN_RPC_URL`, `ESCROW_CONTRACT_ID`
- [x] **Storage (`mock` | `s3` | `r2` | `cloudinary`)**: `STORAGE_PROVIDER`, `S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
- [x] **Email & SMS**: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SENDGRID_API_KEY`, `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM`
- [x] **Frontend & Observability**: `FRONTEND_URL`, `SENTRY_DSN`, `LOG_LEVEL`
