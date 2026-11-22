# Chain Adapter Interface Specification

**Status:** v2.1 (`CHAIN_SPEC_VERSION = 2.1.0`)

This document is the normative v2.1 surface for Navin Backend's Stellar / Soroban integration (v1 closed #649; v2 evolved the escrow signature and event verification per #1056 / #1058; v2.1 adds shipment creation, disputes and RBAC provisioning per #1037 / #1036 / #1042 / #1035).

Single source of truth for shapes: `src/shared/types/chain.ts`. Cross-repo golden vectors: `tests/fixtures/chain/{functions,events,errors}.json` (`spec_version = 2.1.0`). Contracts repo: [Navin-xmr/navin-contracts](https://github.com/Navin-xmr/navin-contracts).

> Drift rule (AGENTS.md §8): doc ↔ `chain.ts` + `CHAIN_SPEC_VERSION` ↔ fixtures `spec_version` must change in the same PR.

---

## 1. Functions

| Function                   | Signature (positional order = object key order)                                                                                                     | Auth (`require_auth`) |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `anchor`                   | `anchor(shipment_id: Symbol, data_hash: BytesN<32>, actor: Address)`                                                                                | `actor`               |
| `init_escrow`              | `init_escrow(payment_id: Symbol, shipment_id: Symbol, payer: Address, payee: Address, token: Address, amount: i128)`                                | `payer`               |
| `release_escrow`           | `release_escrow(caller: Address, shipment_id: Symbol)`                                                                                              | `caller`              |
| `create_shipment`          | `create_shipment(sender: Address, receiver: Address, carrier: Address, data_hash: BytesN<32>, payment_milestones: Vec<i128>, deadline: u64) -> u64` | `sender`              |
| `raise_dispute`            | `raise_dispute(caller: Address, shipment_id: Symbol, reason_hash: BytesN<32>)`                                                                      | `caller`              |
| `resolve_dispute`          | `resolve_dispute(admin: Address, shipment_id: Symbol, outcome: Symbol)`                                                                             | `admin`               |
| `add_company`              | `add_company(admin: Address, company: Address)`                                                                                                     | `admin`               |
| `add_carrier`              | `add_carrier(admin: Address, company: Address, carrier: Address)`                                                                                   | `admin`               |
| `add_carrier_to_whitelist` | `add_carrier_to_whitelist(admin: Address, company: Address, carrier: Address)`                                                                      | `admin`               |

> **v2.1 shipments/disputes/RBAC (#1037 / #1036 / #1042):** `create_shipment` returns the
> contract-assigned `u64` shipment id in the receipt; `sender`, `receiver` and `carrier` must be
> three distinct addresses, validated locally for fast failure before the contract call (the
> contract remains authoritative — its rejections surface unmapped). Disputes use the existing
> `Symbol` shipment id space (the same one `anchor`/`release_escrow` use), not the new `u64` id.
> `resolve_dispute`'s `outcome` is one of `"resolved" | "rejected"` and is only ever read back from
> the resulting `dispute_resolved` event — never decided locally. `add_carrier` registers a carrier
> globally; `add_carrier_to_whitelist` scopes an already-registered carrier to one company.

> **v2 escrow semantics (#1056):** escrow is **per-shipment**, not per-payment. The v1
> `(payment_id, proof_hash)` pair was a backend invention — the deployed contract takes
> `(caller, shipment_id)` and requires the caller's authorization. There is no
> `proof_hash` argument and no legacy `{ success: false }` result: adapters reject with
> `AppError(ERR_CHAIN_*)` (`ERR_CHAIN_INVALID_STATUS`, `ERR_CHAIN_UNAUTHORIZED`, …).

Types: `Symbol` = `[A-Za-z0-9_]{1,32}`; `BytesN<32>` = lowercase hex64 (SHA-256); `Address` = strkey `G…`/`C…`; `token` must be contract `C…`; `amount` = positive `i128` decimal string; `payer ≠ payee`. All arg schemas `.strict()`. Result: `{ tx_hash: hex64, ledger: u32 }`.

---

## 2. Events (topic + data tuples)

Envelope: `{ id, contract_id: C…, tx_hash: hex64, ledger: u32, ledger_closed_at: datetime }` — `id` is the stable paging cursor for idempotent indexing.

| Name               | Topic tuple                                 | Data tuple                                                                              |
| ------------------ | ------------------------------------------- | --------------------------------------------------------------------------------------- |
| `anchor`           | `["anchor", shipment_id: Symbol]`           | `(data_hash: Bytes32Hex, ledger: u32)`                                                  |
| `esc_init`         | `["esc_init", payment_id: Symbol]`          | `(shipment_id: Symbol, payer: Address, payee: Address, token: C…, amount: i128-string)` |
| `esc_rel`          | `["esc_rel", payment_id: Symbol]`           | `(proof_hash: Bytes32Hex, payee: Address, amount: i128-string)`                         |
| `dispute_raised`   | `["dispute_raised", shipment_id: Symbol]`   | `(reason_hash: Bytes32Hex, caller: Address)`                                            |
| `dispute_resolved` | `["dispute_resolved", shipment_id: Symbol]` | `(outcome: "resolved"\|"rejected", caller: Address)`                                    |

Validated at ingress by `parseChainEvent()`; mismatch → `AppError(502, ERR_CHAIN_INVALID_EVENT)`.
The Stellar indexer (`src/workers/stellar-indexer.worker.ts`) mirrors `dispute_raised`/`dispute_resolved`
into the `Payment` projection — the resolution outcome is taken from the event, never decided locally.

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
| `RoleDenied`            | 10    | `ERR_CHAIN_ROLE_DENIED`             | 403  |
| `ShipmentNotFound`      | 11    | `ERR_CHAIN_SHIPMENT_NOT_FOUND`      | 404  |
| `InvalidTransition`     | 12    | `ERR_CHAIN_INVALID_TRANSITION`      | 409  |
| `EscrowLocked`          | 13    | `ERR_CHAIN_ESCROW_LOCKED`           | 409  |
| `InsufficientFunds`     | 14    | `ERR_CHAIN_INSUFFICIENT_FUNDS`      | 422  |
| `ContractPaused`        | 15    | `ERR_CHAIN_CONTRACT_PAUSED`         | 503  |
| `DuplicateAction`       | 16    | `ERR_CHAIN_DUPLICATE_ACTION`        | 409  |
| `TokenTransferFailed`   | 17    | `ERR_CHAIN_TOKEN_TRANSFER_FAILED`   | 502  |
| `RateLimited`           | 18    | `ERR_CHAIN_RATE_LIMITED`            | 429  |
| `CircuitBreakerOpen`    | 19    | `ERR_CHAIN_CIRCUIT_BREAKER_OPEN`    | 503  |
| `ShipmentFinalized`     | 20    | `ERR_CHAIN_SHIPMENT_FINALIZED`      | 409  |
| unknown                 | other | `ERR_CHAIN_UNKNOWN`                 | 502  |

Decoded via `chainErrorToAppError()`.

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

`ChainAdapter` port (`src/services/chain/types.ts`): `anchorEvent`, `releaseEscrow`,
`createShipment`, `raiseDispute`, `resolveDispute`, `addCompany`, `addCarrier`,
`addCarrierToWhitelist`, `preflightRole`, `streamEvents` plus `getConfirmationCount` (and optional
ledger query helpers). `SimulatedAdapter` for local dev/tests; `SorobanAdapter` for deployed WASM
escrow. Legacy `stellar.service.ts` manage-data ops are placeholders to be replaced.

`preflightRole` dry-runs an RBAC action (`add_company`/`add_carrier`/`add_carrier_to_whitelist`)
through simulation only — nothing is assembled, signed or sent — and reports the exact
`ERR_CHAIN_*` the real submission would reject with, so callers can fail with an actionable error
_before_ spending a transaction (#1042). `SimulatedAdapter` has no on-chain role state to deny, so
it always reports `{ allowed: true }`.
