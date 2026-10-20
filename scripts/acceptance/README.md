# Chain Conformance Acceptance Scripts (`P6-20` / Issue #807)

Executable acceptance test scripts validating the four core Stellar / Soroban chain conformance lifecycle scenarios defined in [`docs/chain-interface.md`](../../docs/chain-interface.md).

## Scenarios Covered

| # | Script | Lifecycle Scenario | What It Verifies |
|---|--------|--------------------|------------------|
| 1 | `01-scan-to-anchored.mjs` | **scan → anchored** | Computes canonical 32-byte SHA-256 `data_hash` for a shipment scan, invokes `anchor(shipment_id, data_hash, actor)`, asserts `ANCHORED` receipt (`txHash`, `ledger`) + emitted `anchor` event, and verifies duplicate anchor rejection (`ERR_CHAIN_ALREADY_ANCHORED`). |
| 2 | `02-deliver-to-escrow-released.mjs` | **deliver → escrow released** | Computes canonical delivery `proof_hash`, invokes `release_escrow(payment_id, proof_hash)` on a funded escrow, asserts `RELEASED` status + emitted `esc_rel` event, and verifies double-release rejection (`ERR_CHAIN_ESCROW_ALREADY_RELEASED`). |
| 3 | `03-indexer-ingests-emitted-event.mjs` | **indexer ingests emitted event** | Streams `anchor`, `esc_init`, and `esc_rel` events in ledger order via `streamEvents(cursor)`, maps them to `IN_TRANSIT`, `SETTLEMENT_INITIATED`, and `SETTLEMENT_COMPLETED` ledger blocks, persists `lastCursor`, and verifies idempotent replay. |
| 4 | `04-frontend-verifies-badge-via-bundle.mjs` | **frontend verifies badge via bundle endpoint** | Validates the verification bundle endpoint payload (`onChainHash`, `recomputedHash`, `verified`, `simulated`, `network`, `badgeStatus`, `txHash`, `explorerUrl`) for `VERIFIED`, `SIMULATED_VERIFIED`, and tampered `MISMATCH` states. |

## Running the Acceptance Suite

### Run All 4 Scenarios

```bash
node scripts/acceptance/run-all.mjs
```

### Run Individual Scenarios

```bash
node scripts/acceptance/01-scan-to-anchored.mjs
node scripts/acceptance/02-deliver-to-escrow-released.mjs
node scripts/acceptance/03-indexer-ingests-emitted-event.mjs
node scripts/acceptance/04-frontend-verifies-badge-via-bundle.mjs
```

### Environment Variables (Optional Compose / Standalone Override)

| Variable | Default | Description |
|----------|---------|-------------|
| `STELLAR_NETWORK` | `standalone` | Network identifier (`standalone`, `testnet`, `public`) |
| `SOROBAN_RPC_URL` | `http://127.0.0.1:8000/soroban/rpc` | Optional local quickstart Soroban RPC endpoint |
| `ACCEPTANCE_API_URL` | `http://127.0.0.1:3000` | Optional local compose API base URL |

Each script prints `[PASS]` or `[FAIL]` to stdout/stderr and exits with code `0` on conformance success or `1` on any assertion failure.
