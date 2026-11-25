# Chain conformance acceptance scripts

Four executable scenarios cover the core chain lifecycle. Each script talks to
a running backend (local compose stack or test harness), prints `PASS` or
`FAIL`, and exits non-zero on failure.

## Setup

```bash
docker compose up -d            # or use the nightly quickstart harness
export ACCEPTANCE_API_URL=http://localhost:3000/api
export ACCEPTANCE_TOKEN=<JWT of an ADMIN/MANAGER user>
```

Common variables: `ACCEPTANCE_API_URL` (default `http://localhost:3000/api`)
and `ACCEPTANCE_TOKEN` (required). No script makes a live network call to
Stellar; they assert the API/ledger state produced by the chain adapters and
indexer.

## Scenarios

| Script | Scenario | Extra variables |
|--------|----------|-----------------|
| `01-scan-to-anchored.mjs` | scan a shipment → anchor milestone appears in the ledger | `SCAN_SHIPMENT_ID` |
| `02-deliver-escrow-released.mjs` | deliver → escrow release event recorded | `DELIVERY_SHIPMENT_ID` |
| `03-indexer-ingests-event.mjs` | emitted chain event ingested by the indexer | `INDEXER_EVENT_ID` |
| `04-frontend-badge-verification.mjs` | frontend badge verified via `/ledger/blocks/:id/verification` bundle | `BADGE_BLOCK_ID` |

```bash
SCAN_SHIPMENT_ID=<id> node scripts/acceptance/01-scan-to-anchored.mjs
DELIVERY_SHIPMENT_ID=<id> node scripts/acceptance/02-deliver-escrow-released.mjs
INDEXER_EVENT_ID=<id> node scripts/acceptance/03-indexer-ingests-event.mjs
BADGE_BLOCK_ID=<id> node scripts/acceptance/04-frontend-badge-verification.mjs
```

These complement the full lifecycle demos `run-simulated.mjs` and
`run-soroban.mjs`, which create their own in-memory MongoDB and verify the
Hash-and-Emit hash locally.
