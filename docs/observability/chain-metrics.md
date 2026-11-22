# Chain metrics (#1044)

Prometheus metrics for chain submission, failures, queue depth, confirmation lag and indexer cursor age. Implemented in
`src/infra/metrics/chainMetrics.ts` with `prom-client`. All series carry a constant `network` label (`testnet` | `public`).

## Exposure

| Process                                       | Endpoint                         | Enabled by                             |
| --------------------------------------------- | -------------------------------- | -------------------------------------- |
| API                                           | `GET /api/metrics`               | `METRICS_TOKEN` (>= 16 chars)          |
| Stellar worker / indexer worker (own process) | `GET /metrics` on `METRICS_PORT` | `METRICS_TOKEN` **and** `METRICS_PORT` |

Secure by default: with `METRICS_TOKEN` unset the API route returns `404` and workers open no port. Scrapers send
`Authorization: Bearer <token>` (constant-time compare). Each process has its own registry, so scrape the API and every
worker; **adapter submission metrics are emitted by the process that submits** (normally the stellar worker), while indexer
metrics come from the indexer worker.

```yaml
# prometheus.yml
scrape_configs:
  - job_name: navin-api
    metrics_path: /api/metrics
    authorization: { type: Bearer, credentials_file: /etc/prometheus/navin-metrics-token }
    static_configs: [{ targets: ['api:3000'] }]
  - job_name: navin-workers
    metrics_path: /metrics
    authorization: { type: Bearer, credentials_file: /etc/prometheus/navin-metrics-token }
    static_configs: [{ targets: ['stellar-worker:9464', 'indexer-worker:9465'] }]
```

## Definitions

| Metric                                      | Type      | Labels                    | Unit    | Meaning                                                                                                      |
| ------------------------------------------- | --------- | ------------------------- | ------- | ------------------------------------------------------------------------------------------------------------ |
| `navin_chain_submissions_total`             | counter   | `operation`, `outcome`    | count   | Submission attempts; `outcome` = `success` \| `failure`.                                                     |
| `navin_chain_submission_failures_total`     | counter   | `operation`, `error_code` | count   | Failures by **normalized** error code (see below).                                                           |
| `navin_chain_submission_duration_seconds`   | histogram | `operation`, `outcome`    | seconds | Wall-clock of a submission: build, simulate, sign, send, poll to confirmation.                               |
| `navin_chain_queue_depth`                   | gauge     | `queue`, `state`          | jobs    | BullMQ jobs per queue/state, read at scrape time. Absent (not 0) if Redis is unreachable.                    |
| `navin_chain_confirmation_lag_seconds`      | histogram | `event`                   | seconds | Chain event time (`ledger_closed_at`) to the moment it was verified (>= confirmation threshold).             |
| `navin_indexer_cursor_age_seconds`          | gauge     | —                         | seconds | Now minus the ledger close time of the newest event processed. `NaN` until known. Persisted across restarts. |
| `navin_indexer_last_poll_timestamp_seconds` | gauge     | —                         | unix s  | Last successful indexer cycle. `0` until the first one.                                                      |

Closed label sets: `operation` ∈ `anchor_event`, `release_escrow`; `queue` ∈ `transaction_queue`, `stellar_indexer_queue`
(only `transaction_queue` is reported today); `state` ∈ `waiting`, `active`, `delayed`, `failed`; `event` ∈ the spec chain event
names (`anchor`, `esc_init`, `esc_rel`).

### Cardinality and PII policy

Labels only ever take values from the closed sets above. Shipment ids, transaction hashes, wallet addresses, user ids and raw
exception messages are never labels (`tests/chain.metrics.test.ts` asserts this against hostile error messages).
`error_code` is `normalizeChainError()`: a registered `ERR_CHAIN_*` code, else `ERR_OTHER` (an `AppError` with a non-chain code),
else `ERR_UNCLASSIFIED` (anything else). Max series: ops(2) x outcomes(2) x error codes (~13) — tiny.

### Reading cursor age correctly

On a quiet chain cursor age grows although the indexer is healthy. Alert on cursor age **only while the poller is alive**, or on
`time() - navin_indexer_last_poll_timestamp_seconds` for liveness (see rules).

## Queries

```promql
# Submission failure ratio (15m)
sum(rate(navin_chain_submissions_total{outcome="failure"}[15m])) / sum(rate(navin_chain_submissions_total[15m]))

# Failures by normalized error code
sum by (error_code) (rate(navin_chain_submission_failures_total[15m]))

# p95 submission latency
histogram_quantile(0.95, sum by (le, operation) (rate(navin_chain_submission_duration_seconds_bucket[15m])))

# Queue backlog
navin_chain_queue_depth{state=~"waiting|delayed"}

# p95 confirmation lag by event
histogram_quantile(0.95, sum by (le, event) (rate(navin_chain_confirmation_lag_seconds_bucket[30m])))

# Indexer staleness / liveness
navin_indexer_cursor_age_seconds
time() - navin_indexer_last_poll_timestamp_seconds
```

Ready-made assets: alert rules `ops/prometheus/chain-alerts.yml`, Grafana dashboard `ops/grafana/chain-dashboard.json`
(import in Grafana, select the Prometheus datasource).

## Notes

- The confirmation-lag sample is taken once per block: at insert if already confirmed, otherwise by the reconciliation pass
  (`reverifyAnchoredBlocks`). Telemetry/payment confirmation paths are not part of this histogram.
- Instrumentation swallows its own errors and never alters a submission result or error.
- New submission operations must be added to `CHAIN_OPERATIONS` (e.g. `update_status` once the port method lands).
