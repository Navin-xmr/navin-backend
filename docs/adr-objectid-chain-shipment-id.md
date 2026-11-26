# ADR: ObjectId ↔ On-chain `u64` Shipment ID Mapping

**Status:** Proposed (2026-11-23)
**Issue:** P11-10 (depends on P11-05)
**Scope:** How a MongoDB shipment (`_id`, 24-char hex ObjectId) maps to the contract's `u64` shipment id — ownership, uniqueness, creation ordering, collision handling and lifecycle.

## Context

The backend and the contract identify the same shipment differently:

| Surface                                | `shipment_id` type        | Evidence                                                                 |
| -------------------------------------- | ------------------------- | ------------------------------------------------------------------------ |
| `anchor`                               | `Symbol` (`[A-Za-z0-9_]{1,32}`) | `contracts/abi/navin-escrow.abi.json` (`anchor.inputs[0]`), `docs/chain-interface.md` §1 |
| `init_escrow`, `release_escrow`        | `Symbol`                  | `contracts/abi/navin-escrow.abi.json` (`release_escrow.inputs[1]`)        |
| `update_status`                        | **`u64`**                 | `contracts/abi/navin-escrow.abi.json:72-75`, `docs/chain-interface.md:20,34` |

`src/shared/types/chain.ts:132-153` mirrors that split: `U64StringSchema` + `UpdateStatusArgsSchema`
for `update_status`, `SymbolSchema` + `AnchorArgsSchema` / `ReleaseEscrowArgsSchema` elsewhere.
`src/services/chain/soroban.adapter.ts:149` encodes the status id as
`nativeToScVal(BigInt(args.shipment_id), { type: 'u64' })`, so a hex string is not merely wrong — it
throws before submission. `:88` / `:123` encode the `Symbol`-typed ids.

Current backend behaviour:

- `src/modules/shipments/shipments.service.ts:523` (`anchor`) and `:79` (`release_escrow`) pass
  `shipment._id.toString()`. A 24-char hex ObjectId *is* a legal `Symbol`, but it is **not** a `u64`
  and it is a different identity from the contract's numeric key.
- `updateStatus` has no production caller yet — `src/services/chain/types.ts:39` only defines the
  input — so no `u64` has ever been derived. The mapping must exist before that call site is wired.
- Nothing in the repo today maps the two spaces: no indexed `chainShipmentId` field on `Shipment`
  (`src/modules/shipments/shipments.model.ts`), no counter/sequence, no mapping collection.
- The vendored ABI (spec `2.1.0`) exposes **no** `create_shipment`, so the backend cannot currently
  obtain a contract-assigned id; ids must be allocated here and passed in.
- `docs/chain-interface.md:90` already records the follow-up this ADR closes.

## Decision

**A dedicated mapping collection owns the identity, and the backend owns the keyspace.**

1. **Storage.** `ShipmentChainId` (`src/modules/shipments/shipmentChainId.model.ts`, collection
   `shipmentchainids`) holds one row per `(network, shipmentId)`:
   `network ∈ {testnet, public}` (independent keyspaces), `shipmentId: ObjectId`,
   `chainShipmentId: string` — the canonical decimal `u64` (no leading zeros), exactly the encoding
   `UpdateStatusArgs.shipment_id` expects. The value shape is validated with `U64StringSchema` at the
   repository boundary and never re-declared, so it cannot drift from the spec.
2. **Allocator.** `ShipmentChainIdSequence` (`shipmentChainIdSequence.model.ts`, collection
   `shipmentchainidsequences`) is a monotonic counter keyed by `shipment_chain_id:<network>`, advanced
   with a single atomic `findOneAndUpdate(..., { $inc: { sequence: 1 } }, { upsert: true })`.
   It is deliberately not soft-deletable: resetting it would re-issue ids the contract already knows.
3. **Ownership.** `src/modules/shipments/shipmentChainId.repo.ts` is the only writer. Consumers use
   the `ShipmentChainIdRepository` interface (`read`, `allocate`) exposed as
   `shipmentChainIdRepository`; the chain never allocates an id, and no module writes the collection
   directly. Chain calls stay behind the `ChainAdapter` port (AGENTS.md §7).
4. **Uniqueness.** Two unique indexes make the relation 1:1 and let the database — not application
   logic — arbitrate races:
   - `{ network: 1, shipmentId: 1 }` unique — one `u64` per shipment per deployment.
   - `{ network: 1, chainShipmentId: 1 }` unique — one shipment per `u64` (collision backstop).
5. **Creation ordering.** Validation → mapping row allocated → **first** chain write. Never the
   reverse: a shipment is never anchored/escrowed before its `u64` exists, and the same row is the
   source for the `u64` and for the derived `Symbol`, so the two surfaces cannot disagree.
   For a shipment created before this mapping existed, the id is allocated **lazily** on its first
   chain write (`read` returns `null` until then) — never derived from the ObjectId and never guessed.
6. **Concurrency.** Two concurrent `allocate` calls for the same shipment: the first `create` wins,
   the loser's insert fails with `E11000` on `(network, shipmentId)`, and the loser **re-reads and
   returns the winner's id** — allocation is idempotent, and no second id exists.
7. **Collisions on `chainShipmentId`.** If the reserved value is already owned by another row
   (restored counter, hand-written/imported rows), `create` fails with `E11000` on
   `(network, chainShipmentId)`; the repository retries with the next sequence value, up to
   `MAX_ALLOCATION_ATTEMPTS = 5`, then rejects `500 ERR_INTERNAL_SERVER_ERROR`. The abandoned values
   are **gaps**: ids must be unique, not contiguous.
8. **`Symbol` bridge.** `chainShipmentIdSymbol(u64)` = `nv_<u64>` (`nv_` + a 20-digit `u64` = 23
   chars ≤ the 32-char Symbol limit) for the `Symbol`-typed functions. It is a wire encoding of the
   same numeric identity, not a second identity — one shipment, one number, two encoders.
9. **Lifecycle.** An id is allocated once and is permanent: never renumbered, never reused, never
   re-pointed at another shipment, and never deleted — including when the shipment is soft-deleted
   (the `deletedAt` field exists only to satisfy the global model convention; no application path
   sets it). `read` therefore never allocates, and a shipment's id does not change across retries,
   restarts or reconciliation.

### Failure modes

| Situation                                                    | Behaviour                                                                                                                                    |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Shipment row exists, no mapping ("DB row exists, chain id missing") | `read` → `null`; `allocate` mints the next `u64` before the first chain write. Never derived from `_id`.                                       |
| Mapping row exists, shipment missing or soft-deleted ("vice versa") | `allocate` rejects `404 ERR_SHIPMENT_NOT_FOUND` with the shipment id in `details`; no id is minted and no existing id is re-pointed. `read` still returns the row so reconciliation/audit can see the orphan. |
| Mapping exists, first chain write failed (chain does not know the id) | Retry with the **same** id — the contract's `ShipmentNotFound` / `DuplicateAction` errors are already mapped to `ERR_CHAIN_SHIPMENT_NOT_FOUND` / `ERR_CHAIN_DUPLICATE_ACTION` in `src/shared/types/chain.ts`. |
| Chain knows an id, mapping row missing (restore, import, dropped collection) | Treated as an inconsistency to reconcile **before** any further chain write. Never allocate a second id for that shipment: two ids for one shipment would split its on-chain history. |
| `allocate` races another `allocate`                                | Loser adopts the winner's id via the unique index (`E11000` → re-read).                                                                       |
| `chainShipmentId` already owned by another row                      | Retry with the next sequence value (bounded); exhaustion → `500 ERR_INTERNAL_SERVER_ERROR`.                                                    |
| Input `shipmentId` is not a valid ObjectId                          | `400 ERR_BAD_REQUEST`, before any database or chain call.                                                                                     |
| Counter row missing / value outside `u64`                           | `500 ERR_INTERNAL_SERVER_ERROR` (accelerated by `upsert`, so "missing" is only reachable on a failed write).                                  |

No new error codes are introduced: the modes above reuse `ERR_SHIPMENT_NOT_FOUND`,
`ERR_BAD_REQUEST`, `ERR_INTERNAL_SERVER_ERROR` and the existing `ERR_CHAIN_*` taxonomy. A dedicated
`ERR_CHAIN_ID_MAPPING_*` code can be added later if a client needs to distinguish exhaustion.

## Consequences

- The identity question is answered in one place; `anchor`, `init_escrow`, `release_escrow` and
  `update_status` can address the same shipment without a second key space.
- Allocation is idempotent and safe under concurrency, at the cost of one extra write per shipment
  (the mapping row) and a counter read/write.
- Gaps in the `u64` sequence are expected and harmless; dashboards must not assume contiguity.
- **Not wired yet.** This PR is additive: `src/modules/shipments/shipments.service.ts:79` and `:523`
  still pass the raw ObjectId, the `update_status` call site does not exist, and no backfill for
  pre-existing shipments has been run. Until those land, the `Symbol`-typed functions keep their
  current (hex ObjectId) behaviour and the mapping is only exercised by unit tests.
- `anchor(Symbol)` vs `update_status(u64)` key semantics on the contract side are **unconfirmed**: the
  vendored ABI cannot show whether the contract joins the two. No backend code assumes it does — the
  derived `nv_<u64>` Symbol is a label for one numeric identity, and this ADR's follow-ups include
  confirming that join with the contract owners.
- Uniqueness is enforced at the index level, so a backfill/import must go through `allocate` (or
  reproduce its rules) instead of writing rows by hand.

## Alternatives Considered

- **Indexed `chainShipmentId` field on `Shipment`.** Rejected: mixes identity mapping into the
  operational document, leaves no room for per-network scoping, makes the reverse (`u64` → shipment)
  lookup a second index with no uniqueness guarantee, and every shipment read carries the field.
- **Derive the `u64` from the ObjectId (take its low 8 bytes).** Rejected: silent collisions
  (birthday-bound well below production volume), truncation makes the mapping lossy, and the value
  cannot be reversed for lookups.
- **Hash the ObjectId into a `u64`.** Rejected: collisions merge two shipments' on-chain histories
  with no recovery path, and the value is unintelligible in logs/explorers.
- **Let the contract allocate (`create_shipment` → `u64`) as the source of truth.** Rejected for now:
  the vendored ABI (2.1.0) exposes no such function, and it would force a chain round-trip (or a
  durable "pending" state) into the shipment creation path. This decision stays forward-compatible —
  if `create_shipment` ships, the allocator becomes a writer of the returned id and the mapping's
  uniqueness rules are unchanged.
- **Redis `INCR` for allocation.** Rejected: Redis is not the durable store; losing the counter
  re-issues ids the contract has already seen.
- **Keep the ObjectId as the `Symbol` and add a `u64` only for `update_status`.** Rejected: two
  identities for one shipment; `esc_init` / `esc_rel` events keyed by `Symbol` could not be correlated
  with `u64` status updates.

## Follow-ups (not part of this PR)

1. Wire `shipments.service.ts:79` / `:523` to `allocate` + `chainShipmentIdSymbol`, and use the
   mapping at the future `update_status` call site.
2. Backfill migration for pre-existing shipments plus a migration creating the two unique indexes
   (`migrations/*.js`, `npm run migrate:up`).
3. Reconcile `docs/chain-interface.md:90` (`Symbol` shipment ids vs the deployed ABI) with the
   contract owners and, if the shapes change, run the spec-drift PR (doc ↔ `src/shared/types/chain.ts`
   ↔ `tests/fixtures/chain/*.json`).
4. Add the P11-10 entry to `TODO.md` Part 3 (the canonical tracker has no P11 section today).

Tests for the allocate / read / conflict paths live in `tests/chain.shipment-id-mapping.test.ts`
(behaviour) and `tests/chain.shipment-id-mapping.schema.test.ts` (unique indexes).
