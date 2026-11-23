# Chain Adapter Interface Specification

**Status:** v1 (`CHAIN_SPEC_VERSION = 1.1.0-draft`)

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

| Name           | Topic tuple                            | Data tuple                                                                              |
| -------------- | -------------------------------------- | --------------------------------------------------------------------------------------- |
| `anchor`       | `["anchor", shipment_id: Symbol]`      | `(data_hash: Bytes32Hex, ledger: u32)`                                                  |
| `esc_init`     | `["esc_init", payment_id: Symbol]`     | `(shipment_id: Symbol, payer: Address, payee: Address, token: C…, amount: i128-string)` |
| `esc_rel`      | `["esc_rel", payment_id: Symbol]`      | `(proof_hash: Bytes32Hex, payee: Address, amount: i128-string)`                         |
| `esc_dispute`  | `["esc_dispute", payment_id: Symbol]`  | `(reason_hash: Bytes32Hex)`                                                             |
| `esc_resolve`  | `["esc_resolve", payment_id: Symbol]`  | `(outcome: Symbol)`                                                                     |
| `esc_freeze`   | `["esc_freeze", payment_id: Symbol]`   | `()`                                                                                    |
| `esc_unfreeze` | `["esc_unfreeze", payment_id: Symbol]` | `()`                                                                                    |

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
| unknown                 | other | `ERR_CHAIN_UNKNOWN`                 | 502  |

Decoded via `chainErrorToAppError()`.

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
dev/tests; `SorobanAdapter` for deployed WASM escrow. Legacy `stellar.service.ts` manage-data
ops are placeholders to be replaced.
