# Chain Adapter Interface Specification

**Status:** v1 backend adapter wire format (`CHAIN_SPEC_VERSION = 1.0.0-draft`); frontend verification v2 is defined in §6.

This document is the normative v1 surface for Navin Backend's Stellar / Soroban integration (closes #649, supersedes DRAFT v0 / issue #360).

Single source of truth for shapes: `src/shared/types/chain.ts`. Cross-repo golden vectors: `tests/fixtures/chain/{functions,events,errors}.json` (`spec_version = 1.0.0-draft`). Contracts repo: [Navin-xmr/navin-contracts](https://github.com/Navin-xmr/navin-contracts).

> Drift rule (AGENTS.md §8): doc ↔ `chain.ts` + `CHAIN_SPEC_VERSION` ↔ fixtures `spec_version` must change in the same PR.

---

## 1. Functions

| Function         | Signature (positional order = object key order)                                                                      | Auth (`require_auth`) |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `anchor`         | `anchor(shipment_id: Symbol, data_hash: BytesN<32>, actor: Address)`                                                 | `actor`               |
| `init_escrow`    | `init_escrow(payment_id: Symbol, shipment_id: Symbol, payer: Address, payee: Address, token: Address, amount: i128)` | `payer`               |
| `release_escrow` | `release_escrow(payment_id: Symbol, proof_hash: BytesN<32>)`                                                         | contract admin        |

Types: `Symbol` = `[A-Za-z0-9_]{1,32}`; `BytesN<32>` = lowercase hex64 (SHA-256); `Address` = strkey `G…`/`C…`; `token` must be contract `C…`; `amount` = positive `i128` decimal string; `payer ≠ payee`. All arg schemas `.strict()`. Result: `{ tx_hash: hex64, ledger: u32 }`.

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
| unknown                 | other | `ERR_CHAIN_UNKNOWN`                 | 502  |

Decoded via `chainErrorToAppError()`.

---

## 4. Version policy

- `CHAIN_SPEC_VERSION` bumps on any function/event/error shape change.
- Doc, `chain.ts`, and fixtures land in the same PR; `tests/chain.types.test.ts` enforces the triple.
- Field names stay `snake_case` to mirror the Soroban ABI; object key order is significant.

---

## 5. Adapter strategy

`ChainAdapter` port (`src/services/chain/types.ts`): `anchorEvent`, `releaseEscrow`, `streamEvents`. `SimulatedAdapter` for local dev/tests; `SorobanAdapter` for deployed WASM escrow. Legacy `stellar.service.ts` manage-data ops are placeholders to be replaced.

## 6. Frontend verification v2

The backend adapter schemas above remain v1. The contracts v2 frontend flow verifies the contract's `shipment_created`, `status_updated`, and `milestone_recorded` events directly; it does **not** look for the legacy `anchor` event or a `dataHash` bundle. See the [frontend verification guide](./frontend-chain-verification.md) for a runnable example and fixture.

For each action, fetch the canonical payload and expected hash from the verification API, then query the selected network's Soroban RPC for the transaction and event. Accept only a successful transaction and an event from the configured contract, on the configured network, with the expected event name and transaction hash. Decode the event's `data_hash`, schema version (`version` in the v2 event data), counter, and `idempotency_key` using the contract ABI.

The payload is recursively key-sorted and compact-JSON serialized before SHA-256. The payload's `schema_version` and `idempotency_key` are included in those bytes, so neither may be dropped, defaulted, or substituted during canonicalization. Independently recompute the idempotency key as SHA-256 of `shipment_id` encoded as u64 big-endian, the event type encoded as a Soroban Symbol XDR value, and `event_counter` encoded as u32 big-endian. Require the decoded version and recomputed key to match the canonical payload before comparing its digest with the event's `data_hash`.

The canonical tuple ordering and event-specific ABI are owned by [navin-contracts `FRONTEND_VERIFICATION.md`](https://github.com/Navin-xmr/navin-contracts/blob/main/docs/FRONTEND_VERIFICATION.md). Treat an unknown version, network/contract mismatch, missing event, or any mismatch as **unverified**; do not fall back to backend-provided status. The v2 flow is not yet a change to `src/shared/types/chain.ts` or the v1 golden event fixtures.
