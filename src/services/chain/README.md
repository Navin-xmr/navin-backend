# Chain Adapter

Soroban / Stellar integration abstracted behind a port (`ChainAdapter`) with multiple implementations (Simulated, Soroban).

## Architecture

**Port types** (`types.ts`): Defines the contract — `anchorEvent()`, `releaseEscrow()`, `streamEvents()`, and optional ledger queries.

**Factory** (`factory.ts`): Config-driven selection of adapter implementation. Domain modules depend only on port + factory, never on implementations.

**Implementations**:
- **Simulated** (`simulated.adapter.ts`): Horizon manage-data ops, results carry `simulated: true`, safe for dev/test.
- **Soroban** (`soroban.adapter.ts`): Live contract calls via RPC.

## Sequence Serialization (#1065)

When multiple backend replicas share a keypair, concurrent submissions race to update the account sequence. A transaction failing with `tx_bad_seq` indicates:

1. Process A loads account (sequence = 100)
2. Process B loads account (sequence = 100)
3. Process A submits (sequence becomes 101)
4. Process B submits with sequence = 101 → `tx_bad_seq`

### Solution

**In-process mutex** + **Redis lock** for cluster-wide serialization:

```typescript
// All submissions for sourceAccount must serialize through this gate
await serializeSubmission(sourceAccount, async () => {
  // Only one process/thread per sourceAccount can reach this point
  const account = await loadAccount(sourceAccount);
  // ... build, sign, submit ...
});
```

#### Lock behavior

- **In-process**: `KeyedSerializer` per account — immediate for same-process concurrent calls.
- **Cross-replica**: Redis `SET key value NX EX ttl` for distributed coordination.
- **TTL**: 30s default; if a process crashes, lock auto-releases.
- **Failure handling**: 
  - Redis unavailable → fall back to in-process lock only
  - Lock acquisition timeout → warn and proceed (never blocks indefinitely)
  - Task failure → lock released immediately (never hung)

#### Guarantees

- Concurrent submissions from N processes → zero `tx_bad_seq` reuse
- No deadlock (TTL + auto-release)
- Transparent to domain modules

See `sequence-lock.ts` for implementation.

## Confirmation Tracking (#1067)

Chain events (escrow, breaches) don't emit realtime updates immediately. Clients need confirmation depth for safety.

The `confirmation.ts` service polls for transactions reaching the confirmation threshold (default 3 ledgers) and emits socket events with `txHash` and `ledger` for client verification.

- **Event payload**: Includes `txHash` and `ledger` so clients can independently verify chain state.
- **Constants**: Uses `SOCKET_EVENTS` from `socketEvents.ts` — never string literals.
- **Idempotent**: Repeated runs don't double-emit (checked via `confirmations` field).

See `confirmation.ts` for full details.

## Type Safety

All wire shapes (function args, event tuples) are defined in `src/shared/types/chain.ts` and imported by both adapters. Changes to the spec must update:

1. `docs/chain-interface.md` (normative)
2. `src/shared/types/chain.ts` (+ `CHAIN_SPEC_VERSION`)
3. `tests/fixtures/chain/*.json` (+ `spec_version`)
4. Vendored ABI checksum and contracts-repo commit

See AGENTS.md §8 drift rule.
