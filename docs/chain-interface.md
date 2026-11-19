# Chain Adapter Interface Specification

**Status:** v1 (`CHAIN_SPEC_VERSION = 1.0.0-draft`)

This document is the normative v1 surface for Navin Backend's Stellar / Soroban integration (closes #649, supersedes DRAFT v0 / issue #360).

Single source of truth for shapes: `src/shared/types/chain.ts`. Cross-repo golden vectors: `tests/fixtures/chain/{functions,events,errors}.json` (`spec_version = 1.0.0-draft`). Contracts repo: [Navin-xmr/navin-contracts](https://github.com/Navin-xmr/navin-contracts).

> Drift rule (AGENTS.md §8): doc ↔ `chain.ts` + `CHAIN_SPEC_VERSION` ↔ fixtures `spec_version` must change in the same PR.

---

## 1. Functions

| Function | Signature (positional order = object key order) | Auth (`require_auth`) |
|----------|--------------------------------------------------|-----------------------|
| `anchor` | `anchor(shipment_id: Symbol, data_hash: BytesN<32>, actor: Address)` | `actor` |
| `init_escrow` | `init_escrow(payment_id: Symbol, shipment_id: Symbol, payer: Address, payee: Address, token: Address, amount: i128)` | `payer` |
| `release_escrow` | `release_escrow(payment_id: Symbol, proof_hash: BytesN<32>)` | contract admin |

Types: `Symbol` = `[A-Za-z0-9_]{1,32}`; `BytesN<32>` = lowercase hex64 (SHA-256); `Address` = strkey `G…`/`C…`; `token` must be contract `C…`; `amount` = positive `i128` decimal string; `payer ≠ payee`. All arg schemas `.strict()`. Result: `{ tx_hash: hex64, ledger: u32 }`.

---

## 2. Events (topic + data tuples)

Envelope: `{ id, contract_id: C…, tx_hash: hex64, ledger: u32, ledger_closed_at: datetime }` — `id` is the stable paging cursor for idempotent indexing.

| Name | Topic tuple | Data tuple |
|------|-------------|------------|
| `anchor` | `["anchor", shipment_id: Symbol]` | `(data_hash: Bytes32Hex, ledger: u32)` |
| `esc_init` | `["esc_init", payment_id: Symbol]` | `(shipment_id: Symbol, payer: Address, payee: Address, token: C…, amount: i128-string)` |
| `esc_rel` | `["esc_rel", payment_id: Symbol]` | `(proof_hash: Bytes32Hex, payee: Address, amount: i128-string)` |

Validated at ingress by `parseChainEvent()`; mismatch → `AppError(502, ERR_CHAIN_INVALID_EVENT)`.

---

## 3. Errors (`u32` → backend code)

| Contract error | `u32` | Backend code | HTTP |
|----------------|-------|--------------|------|
| `NotAuthorized` | 1 | `ERR_CHAIN_UNAUTHORIZED` | 403 |
| `InvalidHash` | 2 | `ERR_CHAIN_INVALID_HASH` | 422 |
| `AlreadyAnchored` | 3 | `ERR_CHAIN_ALREADY_ANCHORED` | 409 |
| `EscrowExists` | 4 | `ERR_CHAIN_ESCROW_EXISTS` | 409 |
| `EscrowNotFound` | 5 | `ERR_CHAIN_ESCROW_NOT_FOUND` | 404 |
| `EscrowAlreadyReleased` | 6 | `ERR_CHAIN_ESCROW_ALREADY_RELEASED` | 409 |
| `InvalidAmount` | 7 | `ERR_CHAIN_INVALID_AMOUNT` | 422 |
| `InvalidProof` | 8 | `ERR_CHAIN_INVALID_PROOF` | 422 |
| unknown | other | `ERR_CHAIN_UNKNOWN` | 502 |

Decoded via `chainErrorToAppError()`.

### Submission reliability (`SorobanAdapter`, #1078)

- **Retry:** a submission that is not confirmed within the polling window fails with `ERR_CHAIN_SUBMISSION_TIMEOUT` and is retried up to `CHAIN_SUBMIT_MAX_ATTEMPTS` times (default 3) with exponential backoff from `CHAIN_SUBMIT_BACKOFF_MS` (default 500 ms), capped at `CHAIN_SUBMIT_BACKOFF_MAX_MS`, with jitter. Contract rejections and validation errors are never retried.
- **Duplicate detection:** before every retry the adapter asks the chain whether any earlier attempt's transaction confirmed (`getTransactionLedger`). If one did, its receipt is returned and nothing is sent again. A contract rejection of `AlreadyAnchored` / `EscrowAlreadyReleased` after a timeout gets the same check. If the earlier attempt cannot be verified, the call fails rather than risk a duplicate.
- **Idempotency key:** pass `ChainSubmitOptions { eventType, eventCounter, shipmentId? }` as the second argument of `anchorEvent` / `releaseEscrow`. The key is `sha256(JSON([shipment_id, event_type, event_counter]))` (`buildIdempotencyKey`). A repeat of a completed event returns the original receipt without touching the chain, and a concurrent repeat joins the in-flight call. The record is in memory and per process (bounded to 1000 entries), so after a restart the on-chain duplicate check is what protects you. `releaseEscrow` takes `shipmentId` in the options because its input carries a payment id only. Callers that pass no options get retry but no key-based deduplication.

### Preflight checks (`SorobanAdapter`, #1081)

Off by default. With `CHAIN_PREFLIGHT_ENABLED=true`, read-only checks run before a transaction is signed, in this order, each selectable through `CHAIN_PREFLIGHT_CHECKS` (comma list):

| Check | Passes when | Error |
|-------|-------------|-------|
| `initialized` | the contract is initialized | `ERR_CHAIN_NOT_INITIALIZED` |
| `roles` | the actor holds the Company or Carrier role | `ERR_CHAIN_ROLE_REQUIRED` |
| `whitelist` | a Carrier-only actor is whitelisted (Company actors are exempt) | `ERR_CHAIN_CARRIER_NOT_WHITELISTED` |
| `suspension` | the actor is not suspended | `ERR_CHAIN_ACTOR_SUSPENDED` |
| `token_decimals` | the escrow token reports 7 decimals | `ERR_CHAIN_INVALID_TOKEN_DECIMALS` |

`anchorEvent` checks the `actor`; `releaseEscrow` checks initialization only. `token_decimals` runs when a token is supplied to `runChainPreflight` (escrow initialization); no current port method carries one. The checks read state through `SorobanStateReader`, which calls these **assumed** contract view functions: `is_initialized()`, `has_role(address, role)`, `is_carrier_whitelisted(address)`, `is_suspended(address)`, plus the token's SEP-41 `decimals()`. This spec does not define the first four yet, so confirm or rename them in `CONTRACT_VIEW_FUNCTIONS` before enabling preflight against a deployed contract.

---

## 4. Version policy

- `CHAIN_SPEC_VERSION` bumps on any function/event/error shape change.
- Doc, `chain.ts`, and fixtures land in the same PR; `tests/chain.types.test.ts` enforces the triple.
- Field names stay `snake_case` to mirror the Soroban ABI; object key order is significant.

---

## 5. Adapter strategy

`ChainAdapter` port (`src/services/chain/types.ts`): `anchorEvent`, `releaseEscrow`, `streamEvents`. `SimulatedAdapter` for local dev/tests; `SorobanAdapter` for deployed WASM escrow. The legacy `stellar.service.ts` was removed in #1082; its manage-data logic lives only inside `SimulatedAdapter`.
