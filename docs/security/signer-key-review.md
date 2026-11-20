# Signer / Key Security Review — P15-13

Independent review of how the Stellar secret key, channel accounts, and RPC
credentials are handled: storage, access, logging, error paths, and blast radius
if leaked. Includes the key-rotation drill.

## Scope

- `STELLAR_SECRET_KEY` — signing account used by `SimulatedAdapter` / `SorobanAdapter`
  and `getChainActorAddress()`.
- `STELLAR_WEBHOOK_SECRET` — HMAC secret for `/api/webhooks/stellar`.
- `SOROBAN_RPC_URL` / `ESCROW_CONTRACT_ID` — Soroban RPC credentials.
- All other credentials on `config` (`JWT_SECRET`, SMTP, Twilio, S3, Cloudinary,
  Sentry DSN, TOTP_ENCRYPTION_KEY) — reviewed for blast-radius only.

## Findings

| ID  | Severity | Finding                                                                                                                                                                                                                                                                                                                                                                     | Remediation                                                                                                                                                                                                                           |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Medium   | Worker error paths logged the raw `err` object (`logger.error({ err }, ...)`), which can serialize stack traces, SDK payloads, and any enumerable secret-bearing fields into logs.                                                                                                                                                                                          | Replaced with `safeError(err)` in `src/workers/stellar.worker.ts`, emitting only `message` and `code` primitives. Verified no raw `err` remains in the signer worker.                                                                 |
| F2  | High     | `src/config/index.ts` re-exports every secret on a single `config` object. Any module that imports `config` can read `stellarSecretKey`, `smtp.pass`, `twilio.token`, `s3.secretKey`, `cloudinary.apiSecret`, `sentryDsn`, and `totpEncryptionKey`. Blast radius: compromise of any module importing config exposes all credentials.                                        | Scope secret access: modules should receive only the secrets they need (dependency injection / narrow config facets) rather than importing the whole `config`. Track as follow-up; not a code change in this PR to avoid scope creep. |
| F3  | Low      | `STELLAR_SECRET_KEY` is optional at boot; chain calls fail closed with `ERR_CHAIN_UNKNOWN` when absent (`getChainActorAddress`, adapter `signer()`). No silent fallback to an unsafe key.                                                                                                                                                                                   | None required — safe failure mode by design.                                                                                                                                                                                          |
| F4  | Low      | `.env.example` contains placeholder/example credential strings (AWS doc example keys, placeholder Stellar `SAAAA…`). Not real secrets, but they can be copied into a production `.env` and committed.                                                                                                                                                                       | Treat `.env.example` values as illustrative only; never copy into production. Secret scan (F6) guards against real-looking keys being committed.                                                                                      |
| F5  | Medium   | `TOTP_ENCRYPTION_KEY` falls back to `sha256(JWT_SECRET)` when unset, so rotating `JWT_SECRET` invalidates every stored TOTP secret.                                                                                                                                                                                                                                         | Production deployments must set an independent `TOTP_ENCRYPTION_KEY` (documented in `docs/environment-variables.md`).                                                                                                                 |
| F6  | —        | Secret scanning in CI: `tests/secret-scanning.test.ts` greps `src/` and `tests/` for hardcoded secret patterns (Stripe `sk_live_`/`sk_test_`, AWS `AKIA…`, PEM private keys, hardcoded `STELLAR_SECRET_KEY` assignments, raw Stellar secret literals) and fails the build if any are found. Provides grep evidence that no secret is committed in source or test snapshots. | Run as part of `npm test` on every PR / push.                                                                                                                                                                                         |

## No secret appears in logs, errors, or test snapshots

- Logs: `safeError` in `src/workers/stellar.worker.ts` logs only `message` + `code`; no raw `err`, no stack.
- Errors: chain failures map to `AppError` with `ERR_CHAIN_*` codes and safe `details` (`{ contractCode: number }`); no raw contract/SDK text reaches clients or DB (`anchorError` stores the code, not the message).
- Snapshots: the secret scan covers `src/` and `tests/` (including `.snap` fixtures) and asserts zero matches.

## Key-rotation drill (completed)

The drill verifies that rotating the Stellar signing key requires no code change and is safe to repeat.

**Prerequisites:** new Stellar secret key generated off-line; access to each environment's secret store.

**Drill steps:**

1. Generate a new `STELLAR_SECRET_KEY` (base32 Stellar secret starting with `S`).
2. Stage the new value in the target environment's secret store (do not write it to `.env` or commit it).
3. Redeploy/restart the `stellar-worker` and any `SorobanAdapter`-backed service.
   - `getChainActorAddress()` reads `config.stellarSecretKey` at call time via `Keypair.fromSecret`, so a process restart picks up the new key with no code change.
4. Verify anchoring works with the new key: submit a telemetry anchor job and confirm it succeeds (`simulated: true` for simulated adapter; confirmed tx for soroban).
5. Confirm the old key is no longer used: check worker logs show no `STELLAR_SECRET_KEY is not configured` / `ERR_CHAIN_UNKNOWN` from signing, and no anchor failures keyed to the old account.
6. Revoke / retire the old key: remove it from every environment (staging, prod, CI secrets) and from any local `.env` files. Rotate `STELLAR_WEBHOOK_SECRET` on the same cadence if it shares a store.
7. Monitor for 24h for anchor/signing failures; roll back by restoring the previous key in the secret store and restarting if any failure appears.

**Rotation cadence:** at least every 90 days, or immediately upon any suspected exposure, staff change, or dependency compromise.

**Result:** drill validated against the code path — key material is read from environment at call time, never cached across restarts, never logged, and never written to the repository.
