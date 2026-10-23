# ADR: Worker Topology for Stellar Workers

**Status:** Accepted (2026-09-24)
**Issue:** #600
**Scope:** How the Stellar anchoring and indexing workers are deployed relative to the main API.

## Context

`navin-backend` has several long-running background tasks:

- **Alert reaper** — reaps expired shipment alerts (started from `src/main.ts`).
- **Maintenance scheduler** — periodic maintenance hooks (started from `src/main.ts`).
- **Stellar worker** (`src/workers/stellar.worker.ts`) — processes `transaction_queue` BullMQ jobs
  (anchoring telemetry hashes to Stellar).
- **Stellar indexer** (`src/workers/stellar-indexer.worker.ts`) — polls Horizon on a 30s repeat
  and upserts ledger confirmations into `LedgerBlock`.

The alert reaper and maintenance scheduler are lightweight, low-frequency, and only useful while the
API is up, so running them in-process with the API avoids extra containers and coordination.

The two Stellar workers are I/O-bound, retry-heavy, and must survive independent of API request load.
Running them in-process with the API couples their liveness to the API process and makes them hard to
scale horizontally.

## Decision

Adopt a **hybrid / dedicated** topology:

1. **Alert reaper and maintenance scheduler stay in-process** with the API (`src/main.ts`). Unchanged
   behavior; no new containers.
2. **Stellar workers run as dedicated compose services** in `docker-compose.yml`:
   - `stellar-worker` and `stellar-indexer` are separate services.
   - They share the same env as `app` (env vars + `.env` file), using a `x-worker-env` anchor so the
     env stays in one place.
   - They build the same image as `app` and override only `command`:
     `node dist/src/workers/stellar.worker.js` and `node dist/src/workers/stellar-indexer.worker.js`.
   - They publish **no ports** (they are internal BullMQ workers; only `app` keeps port `3000`).

The indexer worker got a **self-starting entrypoint** (guarded so importing it in tests has no side
effects) and a real Horizon-backed `StellarIndexerClient` (`createHorizonIndexerClient`), so
`npm run worker:stellar-indexer` and the compose service both actually boot the worker.

## Consequences

- `docker compose up` now boots API + both Stellar workers, so queue jobs and Horizon polling are
  observable in worker logs (acceptance criterion for #600).
- Horizontal scaling of Stellar workers is a `docker compose up --scale stellar-worker=2` away (or a
  replica count in an orchestrator), independent of the API.
- Dev hot-reload stays focused on `app` via `docker-compose.override.yml` (issue #602); the dedicated
  workers still run the production `dist` path in the override unless the developer targets them
  separately.
- Env must stay in sync between `app` and workers — enforced by the shared `x-worker-env` anchor.

## Alternatives Considered

- **All in-process:** rejected — ties worker liveness to the API process, no independent scaling.
- **Fully separate build/image per worker:** rejected — same source image, different entrypoint is
  enough; a per-worker Dockerfile adds maintenance cost for no isolation gain.
