# Stellar Chain Integration — Threat Model (v2)

**Scope:** backend ↔ Stellar/Soroban chain boundary (`ChainAdapter`, `stellar-indexer.worker.ts`,
webhook ingress). Companion to `docs/chain-interface.md` (spec v2). Related issues: #1056,
#1058, #1059.

**Trust boundaries:** (1) untrusted HTTP clients → API; (2) Stellar network/RPC/Horizon →
indexer; (3) external webhook sender → webhook route; (4) backend signer → contract RBAC.

## Threat table — attack → impact → control → test

| ID  | Attack                                                       | Impact                                                           | Control                                                                                                                                                                                                           | Negative test                                                                                                                       |
| --- | ------------------------------------------------------------ | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| T1  | Replayed API request (same anchor/release intent sent twice) | Duplicate ledger rows / double settlement                        | Idempotent upsert keyed by `transactionHash` in `indexStellarTransactions`; cursor persisted after each event; no client-supplied idempotency key crosses the chain boundary                                      | `tests/indexer.golden.test.ts` (same tx hash replays to one row); `tests/stellar-indexer.worker.test.ts` cursor resume              |
| T2  | Duplicate chain submission (`tx_bad_seq`, retried job)       | Wasted fees, sequence races, duplicate anchors                   | `KeyedSerializer` serializes submissions per source account; bounded `tx_bad_seq` retry; contract rejects duplicate anchor (`ERR_CHAIN_ALREADY_ANCHORED`) / release (`ERR_CHAIN_ESCROW_ALREADY_RELEASED`)         | `tests/chain.signing-concurrency.test.ts`; `tests/chain.adapter.port.test.ts`                                                       |
| T3  | Forged webhook (attacker POSTs fake anchor confirmation)     | Backend marks unanchored data as verified                        | HMAC-SHA256 over the raw body with `STELLAR_WEBHOOK_SECRET`, constant-time compare (`verifyStellarSignature`)                                                                                                     | `tests/chain.threat-model.test.ts` → rejects missing/wrong signature with 401                                                       |
| T4  | Role confusion — backend assumes on-chain admin rights       | Unauthorized `release_escrow` succeeds / wrong signer            | v2 contract signature is `(caller, shipment_id)` with auth `caller` (`CHAIN_FUNCTION_AUTH`); backend signs as `getChainActorAddress()`; `ERR_CHAIN_UNAUTHORIZED` / `ERR_CHAIN_INVALID_STATUS` surfaced with codes | `tests/chain.v2.schemas.test.ts` (auth pin, error mapping); `tests/chain.threat-model.test.ts` (strict v2 args reject legacy shape) |
| T5  | Hash substitution (mutated `data_hash`/event payload)        | Indexer records a hash that does not match the committed payload | `Bytes32HexSchema`, `.strict()` schemas, canonical payload persisted beside `dataHash`, `parseChainEvent()` rejects drift with `ERR_CHAIN_INVALID_EVENT`                                                          | `tests/chain.v2.schemas.test.ts` (mutations + extra field); `tests/chain.threat-model.test.ts` (forged event rejected)              |
| T6  | Confirmation-depth downgrade / premature verification        | Unconfirmed escrow shown as settled                              | Per-network threshold (`CHAIN_CONFIRMATIONS_TESTNET`/`_PUBLIC`), `confirmations`/`verified` on every event class, idempotent re-verification that never downgrades                                                | `tests/chain.confirmations.test.ts` (0/2/3/10 fixtures)                                                                             |

## Gaps and follow-ups

- **GAP-1:** Webhook HMAC covers authenticity, not freshness. Timestamp/nonce anti-replay at the
  webhook layer is not yet implemented; T1's idempotent upsert limits the blast radius. Filed as a
  follow-up for the webhook owners (not in this PR).
- **GAP-2:** On-chain RBAC assumptions are documented here and in `docs/chain-interface.md`; the
  contracts-team sign-off on `release_escrow(caller, shipment_id)` and error discriminants
  (`InvalidStatus = 9`) is a review item, not a code change.
- **GAP-3:** `SimulatedAdapter.getConfirmationCount()` returns a constant 3 by design; depth
  fixtures use the pure helper so simulated mode cannot mask a verification regression.

## Review

- [x] Controls mapped to executable negative tests (`tests/chain.threat-model.test.ts`).
- [x] Contract-side assumptions recorded for contracts-team review (signature, auth, error codes).
- [ ] Contracts-team sign-off on GAP-2 (tracking item, external to this repository).
