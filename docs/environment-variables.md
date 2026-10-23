# Environment variable matrix

Single reference for every environment variable the Navin Backend reads or expects.

| Legend                 | Meaning                                                             |
| ---------------------- | ------------------------------------------------------------------- |
| **Validated**          | Present in the Zod schema in `src/env.ts`                           |
| **`.env.example`**     | Listed in `.env.example`                                            |
| **Used in code**       | Read via `env` / `config` / `process.env` outside the schema itself |
| **Required**           | Process will not start (or core flows fail) without a valid value   |
| **Implementing issue** | Tracking issue for wiring or hardening a gap                        |
**Source of truth:** [`src/env.schema.ts`](../src/env.schema.ts) (Zod shape + `superRefine` cross-field rules),
mirrored by [`src/env.ts`](../src/env.ts), which parses `process.env` once at import time and calls
`process.exit(1)` on failure. [`src/config/index.ts`](../src/config/index.ts) re-exports the parsed values as
`config`; [`src/config/stellarNetwork.ts`](../src/config/stellarNetwork.ts) derives the default Horizon /
Soroban URLs from `STELLAR_NETWORK`.

Every row below is 1-to-1 with a key in `src/env.schema.ts`. If you add a key to the schema, add a row here.

| Legend               | Meaning                                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Zod rule**         | The exact validator applied in `src/env.schema.ts` (enum / regex / length / coercion).                                                                                                           |
| **Default**          | Value used when the variable is unset or empty-stringable under Zod's `.default()`. `—` means the key has no default and is therefore mandatory.                                                 |
| **Enforced at boot** | `schema` = `superRefine`/field validator → `process.exit(1)` before the server listens. `lazy` = the schema accepts it, but the owning subsystem throws on first use. `n/a` = not Zod-validated. |
| **Required**         | Whether the process cannot start (or the owning feature cannot run) without it.                                                                                                                  |

---

## Core runtime

| Variable          | Validated | `.env.example` | Used in code | Required vs optional                        | Notes / implementing issue                    |
| ----------------- | :-------: | :------------: | :----------: | ------------------------------------------- | --------------------------------------------- |
| `ALLOWED_ORIGINS` |    yes    |      yes       |     yes      | Optional (default `''`)                     | Comma-separated CORS allowlist (`src/config`) |
| `CORS_ORIGIN`     |    yes    |      yes       |     yes      | Optional (default `*`)                      | Legacy single-origin CORS fallback            |
| `JWT_SECRET`      |    yes    |      yes       |     yes      | **Required**                                | Min 32 chars; auth tokens                     |
| `MONGO_URI`       |    yes    |      yes       |     yes      | **Required**                                | Mongo connection string                       |
| `NODE_ENV`        |    yes    |      yes       |     yes      | Optional (default `development`)            | `development` \| `test` \| `production`       |
| `PORT`            |    yes    |      yes       |     yes      | Optional (default `3000`)                   | HTTP listen port                              |
| `REDIS_URL`       |    yes    |      yes       |     yes      | Optional (default `redis://127.0.0.1:6379`) | BullMQ / SSE / caches                         |

## Stellar

| Variable                 | Validated | `.env.example` | Used in code | Required vs optional                                   | Notes / implementing issue                                                                                                                                                                                             |
| ------------------------ | :-------: | :------------: | :----------: | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STELLAR_NETWORK`        |    yes    |      yes       |     yes      | Optional (default `testnet`)                           | `testnet` \| `public`; selects the default Horizon/Soroban URLs (`src/config/stellarNetwork.ts`, implementing [#360](https://github.com/Navin-xmr/navin-backend/issues/360)); an unrecognized value fails fast at boot |
| `HORIZON_URL`            |    yes    |       no       |     yes      | Optional — overrides the URL `STELLAR_NETWORK` derives | `src/services/stellar.service.ts` via `config.horizonUrl`                                                                                                                                                              |
| `STELLAR_SECRET_KEY`     |    yes    |      yes       |     yes      | Optional at boot; **required** for anchoring/signing   | Horizon/SDK workers (`src/services/stellar.service.ts`, `src/services/chain/simulated.adapter.ts`)                                                                                                                     |
| `STELLAR_WEBHOOK_SECRET` |    yes    |      yes       |     yes      | Optional at boot; **required** for webhook HMAC        | `verifyStellarSignature` middleware                                                                                                                                                                                    |

## Frontend & email

| Variable           | Validated | `.env.example` | Used in code | Required vs optional                       | Notes / implementing issue                                            |
| ------------------ | :-------: | :------------: | :----------: | ------------------------------------------ | --------------------------------------------------------------------- |
| `FRONTEND_URL`     |    yes    |      yes       |     yes      | Optional (default `http://localhost:3000`) | Invite / password-reset links                                         |
| `SENDGRID_API_KEY` |    yes    |      yes       |     yes      | Optional                                   | Prefer SendGrid SMTP relay when set (`src/services/email.service.ts`) |
| `SMTP_FROM`        |    yes    |      yes       |     yes      | Optional                                   | From-address for outbound mail                                        |
| `SMTP_HOST`        |    yes    |      yes       |     yes      | Optional                                   | Direct SMTP transport when SendGrid unset                             |
| `SMTP_PASS`        |    yes    |      yes       |     yes      | Optional                                   | SMTP password                                                         |
| `SMTP_PORT`        |    yes    |      yes       |     yes      | Optional (default `587`)                   | SMTP port                                                             |
| `SMTP_USER`        |    yes    |      yes       |     yes      | Optional                                   | SMTP username                                                         |

> **SMTP status:** Schema + transport are implemented. Delivery still depends on providing credentials in each environment. Notifications product work is [#362](https://github.com/Navin-xmr/navin-backend/issues/362) / [#363](https://github.com/Navin-xmr/navin-backend/issues/363).

## Twilio (SMS) — TODO gap

| Variable       | Validated | `.env.example` |   Used in code   | Required vs optional | Notes / implementing issue                                                                                                 |
| -------------- | :-------: | :------------: | :--------------: | -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `TWILIO_FROM`  |    yes    |      yes       | no (config only) | Optional             | **TODO** — exposed on `config.twilio` but no SMS client yet. [#364](https://github.com/Navin-xmr/navin-backend/issues/364) |
| `TWILIO_SID`   |    yes    |      yes       | no (config only) | Optional             | **TODO** — same as above                                                                                                   |
| `TWILIO_TOKEN` |    yes    |      yes       | no (config only) | Optional             | **TODO** — same as above                                                                                                   |

## Storage

| Variable                | Validated | `.env.example` | Used in code | Required vs optional                        | Notes / implementing issue                                                                                           |
| ----------------------- | :-------: | :------------: | :----------: | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `STORAGE_PROVIDER`      |    yes    |      yes       |     yes      | Optional (default `mock`)                   | Selects `mock`, `s3`, `r2`, or `cloudinary`; cloud-provider credentials are required when that provider is selected. |
| `S3_ACCESS_KEY`         |    yes    |      yes       |     yes      | Optional at boot; required for `s3` / `r2`  | S3-compatible access key.                                                                                            |
| `S3_BUCKET`             |    yes    |      yes       |     yes      | Optional at boot; required for `s3` / `r2`  | Bucket used by the selected S3-compatible provider.                                                                  |
| `S3_ENDPOINT`           |    yes    |      yes       |     yes      | Optional                                    | Set for custom S3-compatible endpoints such as Cloudflare R2; AWS S3 can use its default endpoint.                   |
| `S3_REGION`             |    yes    |      yes       |     yes      | Optional (default `us-east-1`)              | S3-compatible region.                                                                                                |
| `S3_SECRET_KEY`         |    yes    |      yes       |     yes      | Optional at boot; required for `s3` / `r2`  | S3-compatible secret key.                                                                                            |
| `CLOUDINARY_CLOUD_NAME` |    yes    |      yes       |     yes      | Optional at boot; required for `cloudinary` | Cloudinary account name.                                                                                             |
| `CLOUDINARY_API_KEY`    |    yes    |      yes       |     yes      | Optional at boot; required for `cloudinary` | Cloudinary API key.                                                                                                  |
| `CLOUDINARY_API_SECRET` |    yes    |      yes       |     yes      | Optional at boot; required for `cloudinary` | Cloudinary API secret.                                                                                               |

## Authentication / TOTP

| Variable              | Validated | `.env.example` | Used in code | Required vs optional                 | Notes / implementing issue                                                                                                                                                       |
| --------------------- | :-------: | :------------: | :----------: | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TOTP_ENCRYPTION_KEY` |    yes    |      yes       |     yes      | Optional (recommended in production) | Exactly 64 hex characters (32 bytes), used for AES-256-GCM encryption of TOTP secrets. If unset, the key is derived from `JWT_SECRET`; production should use an independent key. |

## Soroban / escrow

| Variable             | Validated | `.env.example` | Used in code | Required vs optional                               | Notes / implementing issue                                                                                                 |
| -------------------- | :-------: | :------------: | :----------: | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `ESCROW_CONTRACT_ID` |    yes    |      yes       |     yes      | Required when `SOROBAN_ADAPTER=soroban`            | Contract invoked by `SorobanAdapter`; validated conditionally at startup.                                                  |
| `SOROBAN_RPC_URL`    |    yes    |      yes       |     yes      | Required explicitly when `SOROBAN_ADAPTER=soroban` | Soroban RPC endpoint. Otherwise it defaults from `STELLAR_NETWORK` and can be overridden (`src/config/stellarNetwork.ts`). |
| `SOROBAN_ADAPTER`    |    yes    |      yes       |     yes      | Optional (default `simulated`)                     | Selects `simulated` or `soroban`; an unrecognized value or missing Soroban settings fails validation at startup.           |

### ChainAdapter env matrix

| `SOROBAN_ADAPTER`   | Required settings                                                 | Behaviour                                                                                                                                                                                                                                                         |
| ------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unset / `simulated` | `STELLAR_SECRET_KEY` for signing                                  | `SimulatedAdapter` uses Horizon manage-data anchors/releases; results carry `simulated: true` (no contract, no funds move). Submissions are serialized per signing account; a `tx_bad_seq` from another process is retried (up to 2 times) with a fresh sequence. |
| `soroban`           | `SOROBAN_RPC_URL`, `ESCROW_CONTRACT_ID`, and `STELLAR_SECRET_KEY` | `SorobanAdapter` submits contract calls through Soroban RPC; results carry `simulated: false`. The RPC URL and contract ID are required by environment validation.                                                                                                |
| anything else       | —                                                                 | Env validation fails; process exits at boot.                                                                                                                                                                                                                      |

> Several processes sharing one signing account are safe only up to the bounded `tx_bad_seq` retry; for sustained multi-process load give each worker process its own signing account.

## Observability

| Variable     | Validated | `.env.example` |   Used in code   | Required vs optional | Notes / implementing issue                                                        |
| ------------ | :-------: | :------------: | :--------------: | -------------------- | --------------------------------------------------------------------------------- |
| `LOG_LEVEL`  |    no     |      yes       |       yes        | Optional             | Read directly in `src/shared/logger/logger.ts` (not Zod-validated)                |
| `SENTRY_DSN` |    yes    |      yes       | no (config only) | Optional             | **TODO** — validated and on `config.sentryDsn`, but Sentry SDK is not initialized |

---

## Integration status

| Gap area        | Vars                                                       | Status                                                                                                | Implementing issue                                                              |
| --------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| SMTP / email    | `SMTP_*`, `SENDGRID_API_KEY`                               | Implemented (optional credentials)                                                                    | — / notifications [#362](https://github.com/Navin-xmr/navin-backend/issues/362) |
| Twilio SMS      | `TWILIO_*`                                                 | Schema + config only                                                                                  | [#364](https://github.com/Navin-xmr/navin-backend/issues/364)                   |
| Storage         | `STORAGE_PROVIDER`, `S3_*`, `CLOUDINARY_*`                 | Mock, S3, R2, and Cloudinary adapters are implemented; provider credentials are checked when selected | —                                                                               |
| Soroban escrow  | `SOROBAN_ADAPTER`, `SOROBAN_RPC_URL`, `ESCROW_CONTRACT_ID` | Simulated and Soroban adapters are implemented; Soroban settings are conditionally required           | —                                                                               |
| TOTP encryption | `TOTP_ENCRYPTION_KEY`                                      | Implemented; optional explicit key with a `JWT_SECRET`-derived fallback                               | —                                                                               |
| Sentry          | `SENTRY_DSN`                                               | Schema + config only                                                                                  | TBD (no dedicated issue yet)                                                    |
| Variable          | Zod rule                                                                                     | Default                  | Enforced at boot | Required     | Notes                                                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------- | ------------------------ | ---------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`        | `z.enum(['development','test','production'])`                                                | `development`            | schema           | Optional     | Any other value exits at boot. Read directly by `src/config/helmet.ts` and `src/scripts/seed.ts`.                                               |
| `PORT`            | `z.coerce.number().int().min(1).max(65535)`                                                  | `3000`                   | schema           | Optional     | Coerced from string; `3000.5` or `70000` exit at boot.                                                                                          |
| `MONGO_URI`       | `z.string().min(1)` + `.regex(/^mongodb(\+srv)?:\/\/.+$/)`                                   | —                        | schema           | **Required** | Must start with `mongodb://` or `mongodb+srv://`.                                                                                               |
| `JWT_SECRET`      | `z.string().trim().min(32)`                                                                  | —                        | schema           | **Required** | ≥ 32 characters after trimming. Used for access/refresh tokens **and** as the TOTP encryption fallback key when `TOTP_ENCRYPTION_KEY` is unset. |
| `REDIS_URL`       | `z.string().url()` + `.refine(v => v.startsWith('redis://') \|\| v.startsWith('rediss://'))` | `redis://127.0.0.1:6379` | schema           | Optional     | `rediss://` selects TLS. Drives BullMQ, SSE and caches.                                                                                         |
| `ALLOWED_ORIGINS` | `z.string()`                                                                                 | `''` (empty string)      | schema           | Optional     | Comma-separated CORS allowlist; split and trimmed in `src/config/index.ts`.                                                                     |
| `CORS_ORIGIN`     | `z.string()`                                                                                 | `*`                      | schema           | Optional     | Legacy single-origin CORS fallback.                                                                                                             |
| `LOG_LEVEL`       | _not in the Zod schema_                                                                      | —                        | n/a              | Optional     | Read directly from `process.env` in `src/shared/logger/logger.ts`. Accepted values: `debug` \| `info` \| `warn` \| `error`.                     |

## Stellar

| Variable                 | Zod rule                                      | Default   | Enforced at boot                        | Required                                        | Notes                                                                                                                        |
| ------------------------ | --------------------------------------------- | --------- | --------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `STELLAR_NETWORK`        | `z.enum(['testnet','public'])`                | `testnet` | schema                                  | Optional                                        | Selects the default URLs (see table below). `resolveStellarUrls()` also throws on an unknown network as a self-defence belt. |
| `HORIZON_URL`            | `z.string().url()`                            | derived   | schema                                  | Optional                                        | Overrides only the Horizon URL; `SOROBAN_RPC_URL` still derives from `STELLAR_NETWORK`.                                      |
| `STELLAR_SECRET_KEY`     | `z.string().trim().regex(/^S[A-Z2-7]{20,}$/)` | —         | schema (when set)                       | Optional at boot; **required** to sign          | Must be a base32 Stellar secret starting with `S`. `getChainActorAddress()` throws `ERR_CHAIN_UNKNOWN` if absent.            |
| `STELLAR_WEBHOOK_SECRET` | `z.string().trim().min(16)`                   | —         | schema (when set)                       | Optional at boot; **required** for webhook HMAC | ≥ 16 characters. Used by `verifyStellarSignature`.                                                                           |
| `SOROBAN_RPC_URL`        | `z.string().url()`                            | derived   | schema (URL) + `superRefine` (presence) | **Required when `SOROBAN_ADAPTER=soroban`**     | Overrides the RPC URL derived from `STELLAR_NETWORK`.                                                                        |

### Derived URLs (`src/config/stellarNetwork.ts`)

| `STELLAR_NETWORK` | `config.horizonUrl`                   | `config.sorobanRpcUrl`                |
| ----------------- | ------------------------------------- | ------------------------------------- |
| `testnet`         | `https://horizon-testnet.stellar.org` | `https://soroban-testnet.stellar.org` |
| `public`          | `https://horizon.stellar.org`         | `https://mainnet.sorobanrpc.com`      |

## Soroban / escrow

| Variable             | Zod rule                          | Default                        | Enforced at boot | Required                                    | Notes                                                                                                                     |
| -------------------- | --------------------------------- | ------------------------------ | ---------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `SOROBAN_ADAPTER`    | `z.enum(['simulated','soroban'])` | `simulated`                    | schema           | Optional                                    | Selects the `ChainAdapter` implementation in `src/services/chain/factory.ts`. Any other value exits at boot.              |
| `SOROBAN_RPC_URL`    | `z.string().url()`                | derived from `STELLAR_NETWORK` | `superRefine`    | **Required when `SOROBAN_ADAPTER=soroban`** | `superRefine` issue: `SOROBAN_RPC_URL is required when SOROBAN_ADAPTER=soroban`.                                          |
| `ESCROW_CONTRACT_ID` | `z.string().min(1)`               | —                              | `superRefine`    | **Required when `SOROBAN_ADAPTER=soroban`** | Contract ID used by `SorobanAdapter`. `superRefine` issue: `ESCROW_CONTRACT_ID is required when SOROBAN_ADAPTER=soroban`. |

### `SOROBAN_ADAPTER` behaviour matrix

| `SOROBAN_ADAPTER`   | `STELLAR_SECRET_KEY` | Behaviour                                                                                                                                                                                                                                            |
| ------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unset / `simulated` | set                  | `SimulatedAdapter`: Horizon manage-data anchors/releases; every result carries `simulated: true` (no contract, no funds move). Submissions serialized per signing account; `tx_bad_seq` from another process is retried (≤ 2) with a fresh sequence. |
| unset / `simulated` | unset                | Adapter constructs; every chain call rejects `ERR_CHAIN_UNKNOWN` (500). Anchor jobs mark telemetry `ANCHOR_FAILED`; settlement logs a warning and leaves the payment unreleased.                                                                     |
| `soroban`           | set                  | `SorobanAdapter`: live contract calls against `config.sorobanRpcUrl` / `config.escrowContractId`.                                                                                                                                                    |
| `soroban`           | unset                | Boot succeeds (the key is `superRefine`-optional), but any call that must sign rejects `ERR_CHAIN_UNKNOWN`; `stellar.worker` refuses to start.                                                                                                       |
| anything else       | any                  | Zod enum rejects it → `process.exit(1)`.                                                                                                                                                                                                             |

> Several processes sharing one signing account are safe only up to the bounded `tx_bad_seq` retry; for
> sustained multi-process load give each worker process its own signing account.

## Object storage

`STORAGE_PROVIDER` is Zod-validated (`mock` \| `s3` \| `r2` \| `cloudinary`, default `mock`) and consumed by the
adapter factory in `src/services/storage/index.ts`. The per-provider credential requirements below are enforced
**lazily** — the schema accepts the combination, and `getStorageAdapter()` throws a `StorageError(400)` on first
use if the required credentials are missing.

| Variable                | Zod rule                                  | Default                        | Enforced at boot | Required                                             | Notes                                                                                                                       |
| ----------------------- | ----------------------------------------- | ------------------------------ | ---------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `STORAGE_PROVIDER`      | `z.enum(['mock','s3','r2','cloudinary'])` | `mock`                         | schema (enum)    | Optional                                             | Any other value exits at boot. `mock` needs no credentials.                                                                 |
| `S3_BUCKET`             | `z.string().min(1)`                       | —                              | lazy             | **Required when `STORAGE_PROVIDER` is `s3` or `r2`** | Factory error: `S3 storage requires S3_BUCKET, S3_ACCESS_KEY, and S3_SECRET_KEY env vars`.                                  |
| `S3_ACCESS_KEY`         | `z.string().min(1)`                       | —                              | lazy             | **Required when `STORAGE_PROVIDER` is `s3` or `r2`** | Same factory error as above.                                                                                                |
| `S3_SECRET_KEY`         | `z.string().min(1)`                       | —                              | lazy             | **Required when `STORAGE_PROVIDER` is `s3` or `r2`** | Same factory error as above.                                                                                                |
| `S3_ENDPOINT`           | `z.string().url()`                        | —                              | lazy             | Optional                                             | MinIO / Cloudflare R2 endpoint. Must be a valid URL when set.                                                               |
| `S3_REGION`             | `z.string().min(1)`                       | `us-east-1` (factory fallback) | lazy             | Optional                                             | The factory applies `us-east-1` when the variable is unset.                                                                 |
| `CLOUDINARY_CLOUD_NAME` | `z.string().min(1)`                       | —                              | lazy             | **Required when `STORAGE_PROVIDER=cloudinary`**      | Factory error: `Cloudinary storage requires CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET env vars`. |
| `CLOUDINARY_API_KEY`    | `z.string().min(1)`                       | —                              | lazy             | **Required when `STORAGE_PROVIDER=cloudinary`**      | Same factory error as above.                                                                                                |
| `CLOUDINARY_API_SECRET` | `z.string().min(1)`                       | —                              | lazy             | **Required when `STORAGE_PROVIDER=cloudinary`**      | Same factory error as above.                                                                                                |

### `STORAGE_PROVIDER` requirement matrix

| `STORAGE_PROVIDER` | Required variables                                                     | Optional                                       | Adapter                                           |
| ------------------ | ---------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------- |
| `mock` (default)   | —                                                                      | —                                              | `MockStorageAdapter` (local disk, no credentials) |
| `s3`               | `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`                          | `S3_REGION`, `S3_ENDPOINT`                     | `S3StorageAdapter`                                |
| `r2`               | `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`                          | `S3_REGION`, `S3_ENDPOINT` (set to the R2 URL) | `S3StorageAdapter` in `r2` mode                   |
| `cloudinary`       | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | —                                              | `CloudinaryStorageAdapter`                        |
| anything else      | —                                                                      | —                                              | Zod enum rejects it → `process.exit(1)`           |

> There is **no** `STORAGE_BUCKET` variable. Earlier revisions of this document listed one; the schema uses
> `S3_BUCKET` exclusively (see `docs/storage-adapter.md`).

## Frontend & email

| Variable           | Zod rule                                    | Default                 | Enforced at boot  | Required | Notes                                                       |
| ------------------ | ------------------------------------------- | ----------------------- | ----------------- | -------- | ----------------------------------------------------------- |
| `FRONTEND_URL`     | `z.string().url()`                          | `http://localhost:3000` | schema            | Optional | Base URL for invite / password-reset links.                 |
| `SMTP_HOST`        | `z.string().min(1)`                         | —                       | schema (when set) | Optional | Direct SMTP transport when `SENDGRID_API_KEY` is unset.     |
| `SMTP_PORT`        | `z.coerce.number().int().min(1).max(65535)` | `587`                   | schema            | Optional | Coerced from string.                                        |
| `SMTP_USER`        | `z.string().min(1)`                         | —                       | schema (when set) | Optional |                                                             |
| `SMTP_PASS`        | `z.string().min(1)`                         | —                       | schema (when set) | Optional |                                                             |
| `SMTP_FROM`        | `z.string().email()`                        | —                       | schema (when set) | Optional | Must be a valid email address when set.                     |
| `SENDGRID_API_KEY` | `z.string()`                                | —                       | schema (when set) | Optional | Preferred relay when set (`src/services/email.service.ts`). |

## Twilio (SMS)

| Variable       | Zod rule            | Default | Enforced at boot  | Required | Notes                       |
| -------------- | ------------------- | ------- | ----------------- | -------- | --------------------------- |
| `TWILIO_SID`   | `z.string().min(1)` | —       | schema (when set) | Optional | Exposed on `config.twilio`. |
| `TWILIO_TOKEN` | `z.string().min(1)` | —       | schema (when set) | Optional | Exposed on `config.twilio`. |
| `TWILIO_FROM`  | `z.string().min(1)` | —       | schema (when set) | Optional | Exposed on `config.twilio`. |

> **TODO gap:** no SMS client consumes these yet. Tracked in [#364](https://github.com/Navin-xmr/navin-backend/issues/364).

## TOTP / 2FA

| Variable              | Zod rule                                       | Default | Enforced at boot  | Required                                                 | Notes                                                                                                                                                                                        |
| --------------------- | ---------------------------------------------- | ------- | ----------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TOTP_ENCRYPTION_KEY` | `z.string().trim().regex(/^[0-9a-fA-F]{64}$/)` | —       | schema (when set) | Optional at boot; **strongly recommended in production** | AES-256-GCM key for TOTP secrets at rest in MongoDB. Must be exactly 64 hex characters (32 bytes). Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |

> **Conditional behaviour (`src/modules/auth/totp.utils.ts`):** when `TOTP_ENCRYPTION_KEY` is unset the helpers fall
> back to `sha256(JWT_SECRET)` so development works out of the box. Because that ties 2FA encryption to the JWT
> signing secret, production deployments **SHOULD** set an independent `TOTP_ENCRYPTION_KEY` — rotating `JWT_SECRET`
> would otherwise invalidate every stored TOTP secret. The schema does not hard-fail on production without it.

## Observability

| Variable     | Zod rule                | Default | Enforced at boot  | Required | Notes                                        |
| ------------ | ----------------------- | ------- | ----------------- | -------- | -------------------------------------------- |
| `SENTRY_DSN` | `z.string().url()`      | —       | schema (when set) | Optional | Validated and exposed on `config.sentryDsn`. |
| `LOG_LEVEL`  | _not in the Zod schema_ | —       | n/a               | Optional | See [Core runtime](#core-runtime).           |

---

## Not application variables

| Variable                     | Where it comes from       | Purpose                                                   |
| ---------------------------- | ------------------------- | --------------------------------------------------------- |
| `MONGO_INITDB_ROOT_USERNAME` | `docker-compose.yml` only | Mongo container bootstrap user. Never read by `src/`.     |
| `MONGO_INITDB_ROOT_PASSWORD` | `docker-compose.yml` only | Mongo container bootstrap password. Never read by `src/`. |

---

## Summary of conditional requirements

| Condition                                            | Requirement                                                                   | Enforced by                                                                          |
| ---------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `SOROBAN_ADAPTER=soroban`                            | `SOROBAN_RPC_URL` **and** `ESCROW_CONTRACT_ID` must be set                    | `envSchema.superRefine` → `process.exit(1)`                                          |
| `SOROBAN_ADAPTER` ≠ `simulated`/`soroban`            | —                                                                             | `z.enum` → `process.exit(1)`                                                         |
| `STORAGE_PROVIDER` ∈ {`s3`,`r2`}                     | `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`                                 | `src/services/storage/index.ts` → `StorageError(400)` on first `getStorageAdapter()` |
| `STORAGE_PROVIDER=cloudinary`                        | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`        | same as above                                                                        |
| `STORAGE_PROVIDER` ∉ {`mock`,`s3`,`r2`,`cloudinary`} | —                                                                             | `z.enum` → `process.exit(1)`                                                         |
| `NODE_ENV=production`                                | Set an independent `TOTP_ENCRYPTION_KEY` (**recommended**, not hard-enforced) | `src/modules/auth/totp.utils.ts` falls back to `sha256(JWT_SECRET)`                  |
| `NODE_ENV=production`                                | Never set `MONGO_URI` to the dev `mongodb://127.0.0.1:27017/navin_dev` value  | Operational, not schema-enforced                                                     |

## Summary of gaps

| Gap area             | Vars                                                       | Status                                                                                               |
| -------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| SMTP / email         | `SMTP_*`, `SENDGRID_API_KEY`                               | Implemented (optional credentials); delivery still depends on per-environment credentials            |
| Twilio SMS           | `TWILIO_*`                                                 | Schema + config only — no SMS client ([#364](https://github.com/Navin-xmr/navin-backend/issues/364)) |
| S3 / R2 / Cloudinary | `S3_*`, `CLOUDINARY_*`, `STORAGE_PROVIDER`                 | Implemented — adapters exist and are selected at runtime                                             |
| Soroban escrow       | `SOROBAN_ADAPTER`, `SOROBAN_RPC_URL`, `ESCROW_CONTRACT_ID` | Implemented — `SorobanAdapter` performs live contract calls                                          |
| Sentry               | `SENTRY_DSN`                                               | Schema + config only — the Sentry SDK is not initialized                                             |
| TOTP production key  | `TOTP_ENCRYPTION_KEY`                                      | Implemented but **optional**; recommended in production                                              |

---

## Cross-check checklist

Every key in `src/env.schema.ts`, in schema order:

- [x] `NODE_ENV`, `PORT`, `MONGO_URI`, `JWT_SECRET`
- [x] `STELLAR_SECRET_KEY`, `STELLAR_WEBHOOK_SECRET`, `STELLAR_NETWORK`
- [x] `ALLOWED_ORIGINS`, `REDIS_URL`, `CORS_ORIGIN`
- [x] `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SENDGRID_API_KEY`
- [x] `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM`
- [x] `STORAGE_PROVIDER`
- [x] `S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION`
- [x] `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
- [x] `HORIZON_URL`, `SOROBAN_ADAPTER`, `SOROBAN_RPC_URL`, `ESCROW_CONTRACT_ID`
- [x] `SENTRY_DSN`, `FRONTEND_URL`, `TOTP_ENCRYPTION_KEY`

Non-schema names that are still read under `src/`:

- [x] `ALLOWED_ORIGINS`, `CORS_ORIGIN`, `JWT_SECRET`, `MONGO_URI`, `NODE_ENV`, `PORT`, `REDIS_URL`
- [x] `STELLAR_NETWORK`, `HORIZON_URL`, `STELLAR_SECRET_KEY`, `STELLAR_WEBHOOK_SECRET`
- [x] `FRONTEND_URL`, `SENDGRID_API_KEY`, `SMTP_*`
- [x] `TWILIO_*`, `STORAGE_PROVIDER`, `S3_*`, `CLOUDINARY_*`, `SOROBAN_ADAPTER`, `SOROBAN_RPC_URL`, `ESCROW_CONTRACT_ID`, `TOTP_ENCRYPTION_KEY`, `SENTRY_DSN`
- [x] `LOG_LEVEL` (unvalidated)
- [x] `LOG_LEVEL` (`src/shared/logger/logger.ts` — unvalidated)
