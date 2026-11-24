# Chain Adapter Interface Specification

**Status:** v2.1 (`CHAIN_SPEC_VERSION = 2.1.0`); frontend verification v2 is defined in §7.

This document is the normative v2 surface for Navin Backend's Stellar / Soroban integration (v1 closed #649; v2 evolves the escrow signature and event verification per #1056 / #1058).

Single source of truth for shapes: `src/shared/types/chain.ts`. Cross-repo golden vectors: `tests/fixtures/chain/{functions,events,errors}.json` (`spec_version = 2.1.0`). Contracts repo: [Navin-xmr/navin-contracts](https://github.com/Navin-xmr/navin-contracts).

> Drift rule (AGENTS.md §8): doc ↔ `chain.ts` + `CHAIN_SPEC_VERSION` ↔ fixtures `spec_version` must change in the same PR.

---

## 1. Functions

| Function         | Signature (positional order = object key order)                                                                      | Auth (`require_auth`) |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `anchor`         | `anchor(shipment_id: Symbol, data_hash: BytesN<32>, actor: Address)`                                                 | `actor`               |
| `init_escrow`    | `init_escrow(payment_id: Symbol, shipment_id: Symbol, payer: Address, payee: Address, token: Address, amount: i128)` | `payer`               |
| `release_escrow` | `release_escrow(payment_id: Symbol, proof_hash: BytesN<32>)`                                                         | contract admin        |
| `release_escrow` | `release_escrow(caller: Address, shipment_id: Symbol)`                                                               | `caller`              |
| `update_status`  | `update_status(caller: Address, shipment_id: u64, new_status: ShipmentStatus, data_hash: BytesN<32>)`                | `caller`              |

> **v2 escrow semantics (#1056):** escrow is **per-shipment**, not per-payment. The v1
> `(payment_id, proof_hash)` pair was a backend invention — the deployed contract takes
> `(caller, shipment_id)` and requires the caller's authorization. There is no
> `proof_hash` argument and no legacy `{ success: false }` result: adapters reject with
> `AppError(ERR_CHAIN_*)` (`ERR_CHAIN_INVALID_STATUS`, `ERR_CHAIN_UNAUTHORIZED`, …).

Types: `Symbol` = `[A-Za-z0-9_]{1,32}`; `BytesN<32>` = lowercase hex64 (SHA-256); `Address` = strkey `G…`/`C…`; `token` must be contract `C…`; `amount` = positive `i128` decimal string; `payer ≠ payee`. All arg schemas `.strict()`. Result: `{ tx_hash: hex64, ledger: u32 }`.

### 1.1 `update_status` (v2.1, #1047)

Sourced from the real contract (`Navin-xmr/navin-contracts`, `contracts/shipment/src/lib.rs`), not inferred.

- `shipment_id` is a **`u64`** (decimal string in `UpdateStatusArgs`), unlike the legacy `Symbol` ids above.
- `new_status: ShipmentStatus` is a unit-variant `#[contracttype]` enum, encoded as ScVal `vec[Symbol(<Variant>)]`.
  Variants (declaration order, an ABI contract — renames/reorders are breaking):
  `Created, InTransit, AtCheckpoint, PartiallyDelivered, Delivered, Disputed, Cancelled, PartiallyRefunded`.
- `data_hash` is computed by the **backend** over the canonical status payload. The adapter encodes it as 32 raw bytes and
  never hashes, normalizes or alters it.
- Errors use the contract's real `NavinError` numbering (see §3.1), decoded per-function.

---

## 2. Events (topic + data tuples)

Envelope: `{ id, contract_id: C…, tx_hash: hex64, ledger: u32, ledger_closed_at: datetime }` — `id` is the stable paging cursor for idempotent indexing.

| Name       | Topic tuple                        | Data tuple                                                                              |
| ---------- | ---------------------------------- | --------------------------------------------------------------------------------------- |
| `anchor`   | `["anchor", shipment_id: Symbol]`  | `(data_hash: Bytes32Hex, ledger: u32)`                                                  |
| `esc_init` | `["esc_init", payment_id: Symbol]` | `(shipment_id: Symbol, payer: Address, payee: Address, token: C…, amount: i128-string)` |
| `esc_rel`  | `["esc_rel", payment_id: Symbol]`  | `(proof_hash: Bytes32Hex, payee: Address, amount: i128-string)`                         |

Validated at ingress by `parseChainEvent()`; mismatch → `AppError(502, ERR_CHAIN_INVALID_EVENT)`.

---

## 3. Errors (`u32` → backend code)

| Contract error          | `u32` | Backend code                        | HTTP |
| ----------------------- | ----- | ----------------------------------- | ---- |
| `NotAuthorized`         | 1     | `ERR_CHAIN_UNAUTHORIZED`            | 403  |
| `InvalidHash`           | 2     | `ERR_CHAIN_INVALID_HASH`            | 422  |
| `AlreadyAnchored`       | 3     | `ERR_CHAIN_ALREADY_ANCHORED`        | 409  |
| `EscrowExists`          | 4     | `ERR_CHAIN_ESCROW_EXISTS`           | 409  |
| `EscrowNotFound`        | 5     | `ERR_CHAIN_ESCROW_NOT_FOUND`        | 404  |
| `EscrowAlreadyReleased` | 6     | `ERR_CHAIN_ESCROW_ALREADY_RELEASED` | 409  |
| `InvalidAmount`         | 7     | `ERR_CHAIN_INVALID_AMOUNT`          | 422  |
| `InvalidProof`          | 8     | `ERR_CHAIN_INVALID_PROOF`           | 422  |
| `InvalidStatus`         | 9     | `ERR_CHAIN_INVALID_STATUS`          | 409  |
| unknown                 | other | `ERR_CHAIN_UNKNOWN`                 | 502  |

Decoded via `chainErrorToAppError()`.

### Submission reliability (`SorobanAdapter`, #1078)

- **Retry:** a submission that is not confirmed within the polling window fails with `ERR_CHAIN_SUBMISSION_TIMEOUT` and is retried up to `CHAIN_SUBMIT_MAX_ATTEMPTS` times (default 3) with exponential backoff from `CHAIN_SUBMIT_BACKOFF_MS` (default 500 ms), capped at `CHAIN_SUBMIT_BACKOFF_MAX_MS`, with jitter. Contract rejections and validation errors are never retried.
- **Duplicate detection:** before every retry the adapter asks the chain whether any earlier attempt's transaction confirmed (`getTransactionLedger`). If one did, its receipt is returned and nothing is sent again. A contract rejection of `AlreadyAnchored` / `EscrowAlreadyReleased` after a timeout gets the same check. If the earlier attempt cannot be verified, the call fails rather than risk a duplicate.
- **Idempotency key:** pass `ChainSubmitOptions { eventType, eventCounter, shipmentId? }` as the second argument of `anchorEvent` / `releaseEscrow`. The key is `sha256(JSON([shipment_id, event_type, event_counter]))` (`buildIdempotencyKey`). A repeat of a completed event returns the original receipt without touching the chain, and a concurrent repeat joins the in-flight call. The record is in memory and per process (bounded to 1000 entries), so after a restart the on-chain duplicate check is what protects you. `releaseEscrow` takes `shipmentId` in the options because its input carries a payment id only. Callers that pass no options get retry but no key-based deduplication.

### Preflight checks (`SorobanAdapter`, #1081)

Off by default. With `CHAIN_PREFLIGHT_ENABLED=true`, read-only checks run before a transaction is signed, in this order, each selectable through `CHAIN_PREFLIGHT_CHECKS` (comma list):

| Check            | Passes when                                                     | Error                               |
| ---------------- | --------------------------------------------------------------- | ----------------------------------- |
| `initialized`    | the contract is initialized                                     | `ERR_CHAIN_NOT_INITIALIZED`         |
| `roles`          | the actor holds the Company or Carrier role                     | `ERR_CHAIN_ROLE_REQUIRED`           |
| `whitelist`      | a Carrier-only actor is whitelisted (Company actors are exempt) | `ERR_CHAIN_CARRIER_NOT_WHITELISTED` |
| `suspension`     | the actor is not suspended                                      | `ERR_CHAIN_ACTOR_SUSPENDED`         |
| `token_decimals` | the escrow token reports 7 decimals                             | `ERR_CHAIN_INVALID_TOKEN_DECIMALS`  |

`anchorEvent` checks the `actor`; `releaseEscrow` checks initialization only. `token_decimals` runs when a token is supplied to `runChainPreflight` (escrow initialization); no current port method carries one. The checks read state through `SorobanStateReader`, which calls these **assumed** contract view functions: `is_initialized()`, `has_role(address, role)`, `is_carrier_whitelisted(address)`, `is_suspended(address)`, plus the token's SEP-41 `decimals()`. This spec does not define the first four yet, so confirm or rename them in `CONTRACT_VIEW_FUNCTIONS` before enabling preflight against a deployed contract.

### 3.1 `update_status` errors (real `NavinError` numbering)

The table above predates the deployed contract and numbers errors differently (its `InvalidStatus` is `9`; the contract's is `5`).
`update_status` therefore decodes with its own function-scoped table via `updateStatusErrorToAppError()`:

| Contract error      | `u32` | Backend code                                 | HTTP |
| ------------------- | ----- | -------------------------------------------- | ---- |
| `Unauthorized`      | 3     | `ERR_CHAIN_UNAUTHORIZED`                     | 403  |
| `ShipmentNotFound`  | 4     | `ERR_CHAIN_SHIPMENT_NOT_FOUND`               | 404  |
| `InvalidStatus`     | 5     | `ERR_CHAIN_INVALID_STATUS`                   | 409  |
| `InvalidHash`       | 6     | `ERR_CHAIN_INVALID_HASH`                     | 422  |
| `ShipmentFinalized` | 38    | `ERR_CHAIN_INVALID_STATUS`                   | 409  |
| `DuplicateAction`   | 41    | `ERR_CHAIN_DUPLICATE_ACTION`                 | 409  |
| other               | —     | `ERR_CHAIN_UNKNOWN` (code kept in `details`) | 502  |

> **Follow-up:** reconcile the legacy anchor/escrow error table and `Symbol` shipment ids with the deployed contract ABI.

---

## 4. Version policy

- `CHAIN_SPEC_VERSION` bumps on any function/event/error shape change.
- Doc, `chain.ts`, and fixtures land in the same PR; `tests/chain.types.test.ts` enforces the triple.
- Field names stay `snake_case` to mirror the Soroban ABI; object key order is significant.

---

## 5. Confirmation depth (#1058)

Every anchored event class — shipment anchors, status updates, milestones and escrow — exposes
the same verification pair:

| Field           | Meaning                                                             |
| --------------- | ------------------------------------------------------------------- |
| `confirmations` | Ledgers closed strictly after the event's ledger (`0` at the head). |
| `verified`      | `true` once `confirmations >= threshold`.                           |

The threshold is configured per network: `CHAIN_CONFIRMATIONS_TESTNET` / `CHAIN_CONFIRMATIONS_PUBLIC`
(default `3` each), exposed as `config.chainConfirmations`. `ChainAdapter.getConfirmationCount(ledger)`
is the single depth source; the indexer stores both fields on every `LedgerBlock` and its
reconciliation pass moves rows forward idempotently (a confirmed row is never downgraded).
Fixture tests exercise depths `0, 2, 3, 10`.

---

## 6. Adapter strategy

`ChainAdapter` port (`src/services/chain/types.ts`): `anchorEvent`, `releaseEscrow`, `updateStatus`, `streamEvents`
plus `getConfirmationCount` (and optional ledger query helpers). `SimulatedAdapter` for local
dev/tests; `SorobanAdapter` for deployed WASM escrow. The legacy `stellar.service.ts` was removed in #1082;
its manage-data logic lives only inside `SimulatedAdapter`.

## 7. Frontend verification v2

The backend adapter schemas above remain v2.1. The contracts v2 frontend flow verifies the contract's `shipment_created`, `status_updated`, and `milestone_recorded` events directly; it does **not** look for the legacy `anchor` event or a `dataHash` bundle. See the [frontend verification guide](./frontend-chain-verification.md) for a runnable example and fixture.

For each action, fetch the canonical payload and expected hash from the verification API, then query the selected network's Soroban RPC for the transaction and event. Accept only a successful transaction and an event from the configured contract, on the configured network, with the expected event name and transaction hash. Decode the event's `data_hash`, schema version (`version` in the v2 event data), counter, and `idempotency_key` using the contract ABI.

The payload is recursively key-sorted and compact-JSON serialized before SHA-256. The payload's `schema_version` and `idempotency_key` are included in those bytes, so neither may be dropped, defaulted, or substituted during canonicalization. Independently recompute the idempotency key as SHA-256 of `shipment_id` encoded as u64 big-endian, the event type encoded as a Soroban Symbol XDR value, and `event_counter` encoded as u32 big-endian. Require the decoded version and recomputed key to match the canonical payload before comparing its digest with the event's `data_hash`.

The canonical tuple ordering and event-specific ABI are owned by [navin-contracts `FRONTEND_VERIFICATION.md`](https://github.com/Navin-xmr/navin-contracts/blob/main/docs/FRONTEND_VERIFICATION.md). Treat an unknown version, network/contract mismatch, missing event, or any mismatch as **unverified**; do not fall back to backend-provided status.
