# Telemetry Ingestion Pipeline

End-to-end flow from IoT webhook intake through BullMQ anchoring, Socket.IO fan-out, and anomaly detection.

Related real-time event payloads are documented in [websockets.md](./websockets.md).
OpenAPI request/response schemas live in [swagger.yaml](./swagger.yaml) under `POST /api/webhooks/iot` and `POST /api/webhooks/stellar`.

## Sequence diagram

```mermaid
sequenceDiagram
    autonumber
    participant Device as IoT Device / Gateway
    participant API as API (POST /api/webhooks/iot)
    participant Norm as Normalize stage
    participant Mongo as MongoDB (Telemetry)
    participant TQ as BullMQ transaction_queue
    participant Socket as Socket.IO
    participant Detect as Detect anomaly stage
    participant AQ as alert_queue
    participant Worker as Stellar worker
    participant Stellar as Stellar network
    participant WH as API (POST /api/webhooks/stellar)

    Device->>API: POST telemetry (x-api-key)<br/>union: shipmentId form OR sensorId+temp+location
    Note over API: Auth via requireApiKey<br/>Validate IotWebhookBodySchema
    API->>Norm: normalizeIotWebhookBody()
    Note over Norm: Map temp→temperature,<br/>location.lat/lng→lat/lng<br/>Resolve shipmentId from sensorId if needed
    Norm->>Mongo: createTelemetryRecord<br/>(anchorStatus=PENDING_ANCHOR, dataHash)
    Norm->>TQ: pushStellarAnchorJob<br/>(anchor_telemetry job)
    Note over TQ: Queue name: transaction_queue<br/>Job: anchor_telemetry (3 attempts, exp backoff)
    Norm->>Socket: emitTelemetryUpdate<br/>(location:update room event)
    API-->>Device: 202 Accepted<br/>Telemetry received and queued for Stellar anchoring

    Note over Detect: Async via setImmediate<br/>(does not block 202)
    API->>Detect: detectTelemetryAnomalies<br/>(telemetryId, shipmentId, temp,<br/>humidity, battery, shock, lat/lng)
    Note over Detect: Thresholds from<br/>resolveTelemetryThresholdsForShipment<br/>Defaults: maxTemp=25°C, maxHumidity=80%,<br/>minBatteryLevel=20%
    alt anomaly detected
        Detect->>Mongo: Telemetry flags<br/>(isAnomaly=true, anomalyType)
        Detect->>Socket: emitAnomalyDetected<br/>(anomaly:detected, severity HIGH)
        Detect->>AQ: pushAlertJob(...)
        Note over AQ: Queue name: alert_queue<br/>(Redis list via LPUSH)
    end

    Worker->>TQ: consume anchor_telemetry
    Worker->>Stellar: anchorTelemetryHash(shipmentId, dataHash)
    alt anchor success
        Worker->>Mongo: updateTelemetryAnchor(stellarTxHash)<br/>anchorStatus=ANCHORED
    else anchor failure
        Worker->>Mongo: markTelemetryAnchorFailed<br/>anchorStatus=ANCHOR_FAILED
        Note over Worker: BullMQ retries up to 3 times
    end

    Note over WH: Separate settlement path<br/>(proof-of-delivery / escrow callbacks)
    Stellar-->>WH: POST settlement event<br/>(x-stellar-signature HMAC)
    WH->>Mongo: updatePaymentStatus + ledger block
    WH-->>Stellar: 200 OK
```

## Stage annotations

| Stage | Trigger | Implementation | Notes |
|-------|---------|----------------|-------|
| **1. Ingest** | `POST /api/webhooks/iot` with `x-api-key` | `iot.controller.ts` / `iot.routes.ts` | Returns **202** immediately after persist + queue enqueue. |
| **2. Normalize** | Validated webhook body | `normalizeIotWebhookBody` in `iot.service.ts` | Accepts a **union** of shipment-centric and sensor-centric payloads (see Swagger). |
| **3. Persist** | Normalized body | `telemetryService.createTelemetryRecord` | Stores `dataHash`, `rawPayload`, `anchorStatus=PENDING_ANCHOR`. |
| **4. Queue (anchor)** | After persist | `pushStellarAnchorJob` → BullMQ **`transaction_queue`** | Job name `anchor_telemetry`; 3 attempts with exponential backoff. |
| **5. Emit socket** | After queue | `emitTelemetryUpdate` | Event: `location:update` (see websockets.md). |
| **6. Detect anomaly (webhook path)** | `setImmediate` after 202 | `detectTelemetryAnomalies` (`src/services/telemetryAnomalyDetection.ts`) | Uses org/shipment thresholds via `resolveTelemetryThresholdsForShipment`; defaults **25°C / 80% RH / 20% battery**. Types: `TEMPERATURE_BREACH` / `HUMIDITY_BREACH` / `SHOCK_EVENT` / `GPS_LOST` / `BATTERY_LOW`; severity is always `HIGH` on this path. |
| **7. Emit + alert** | When `result.isAnomaly && result.anomalyType` | `emitAnomalyDetected` + `pushAlertJob` | Event: `anomaly:detected` (severity `HIGH`); alert path uses Redis list **`alert_queue`**. The telemetry record is flagged (`isAnomaly=true`, `anomalyType`) inside the detection call. |
| **8. Anchor** | BullMQ worker | `stellar.worker.ts` on `transaction_queue` | Writes `stellarTxHash` or marks `ANCHOR_FAILED`. |
| **9. Settlement webhook** | Stellar callbacks | `POST /api/webhooks/stellar` | HMAC-verified payment status updates (`release` / `escrow` / `failed`). |

## BullMQ / Redis queues

| Queue name | Mechanism | Producer | Consumer | Purpose |
|------------|-----------|----------|----------|---------|
| `transaction_queue` | BullMQ `Queue` / `Worker` | `pushStellarAnchorJob` (`src/infra/redis/queue.ts`) | `src/workers/stellar.worker.ts` | Anchor telemetry data hashes on Stellar. |
| `alert_queue` | Redis list (`LPUSH`) + BullMQ worker variant | `pushAlertJob` (`src/infra/redis/queue.ts`) | Alert workers (`src/workers/alert.worker.ts`, `src/services/queue.service.ts`) | Fan out anomaly / status alerts. |

Both names are stable contract identifiers — do not rename without a coordinated worker deploy.

### Redis durability (H2.4 decision)

Both queues live in the compose `redis` service, which runs with AOF persistence
(`redis-server --appendonly yes`) backed by the named `redis_data` volume
(`docker-compose.yml`). **Decision: persistent, not ephemeral** — queued Stellar anchors and
alerts survive `redis` container restarts. Tradeoffs recorded: AOF uses the default
`appendfsync everysec`, so a hard crash can lose up to ~1s of writes, plus minor fsync
overhead; `docker compose down -v` still destroys the volume; and a single-node Redis with AOF
is crash durability, not HA or backup — production should use managed Redis with replication,
persistence, and backups.

#### Durability boundary

What is and is not covered, stated explicitly so nobody reads more into the
setup than it guarantees:

| Scenario | Durable? | Notes |
|----------|----------|-------|
| `docker compose restart redis` | **Yes** | Container is recreated against the same `redis_data` volume. Covered by the automated check below. |
| `docker compose stop redis` / `start redis` | **Yes** | Same volume, same guarantee. |
| `docker compose down` (no `-v`) | **Yes** | Volume is retained; the next `up` recovers the queues. |
| `docker compose down -v` | **No** | **Deletes the volume and every queued job.** This is the boundary the check exists to keep honest. |
| `docker compose down -v --volumes=<other project>` | **No** | `-v` is scoped to the project you name, so a *different* project's volumes are untouched. |
| Host crash / power loss | **Up to ~1s lost** | AOF runs at the default `appendfsync everysec`. |
| `docker system prune --volumes`, or deleting the volume by hand | **No** | Outside the mechanism entirely. |

AOF is a **durability** feature, not a **backup** or **HA** strategy:

- It is a single-node, local append-only log. If the volume is lost, so is the
  queue. There is no copy elsewhere.
- It gives no failover, replication, or read-scaling. A second Redis node is
  not a hot spare here.
- Recovery beyond "the same volume came back" needs a real backup/restore
  story. For production, run managed Redis with replication, persistence, and
  scheduled backups, and treat the Compose setup as development-only.

#### Automated check (`redis-persistence` CI job)

The `compose-smoke` job only waits for `/api/health`; it never inspects queue
state, so it cannot catch a silently broken persistence config. The
`redis-persistence` job closes that gap.

`scripts/redis-persistence-probe.mjs` is a two-phase check:

```bash
# 1. Enqueue a real BullMQ job on transaction_queue.
docker compose -p redis-persistence -f docker-compose.yml up -d redis
node scripts/redis-persistence-probe.mjs enqueue

# 2. Restart ONLY the redis container, leaving the volume in place.
docker compose -p redis-persistence -f docker-compose.yml restart redis

# 3. Assert the job survived and is still processable. Non-zero exit on failure.
node scripts/redis-persistence-probe.mjs verify

docker compose -p redis-persistence -f docker-compose.yml down -v
```

`verify` does more than look the job up — it drains the queue with a local
worker and asserts the payload round-tripped, so "still available" and "still
processable" are both covered. It also re-reads `CONFIG GET appendonly`, which
is what makes the check **fail if AOF is removed** rather than quietly degrading
to ephemeral. Removing the `redis_data` volume fails it the same way: the job
is simply gone.

Two isolation properties are deliberate:

- Only the `redis` service is started. With the full stack up, the
  `stellar-worker` container would consume the probe job *before* the restart,
  leaving nothing to assert.
- The project name is `redis-persistence`, so the probe uses its own
  `redis-persistence_redis_data` volume. A developer's local stack and its data
  are never involved, and the `down -v` teardown is scoped to that one project.

Environment overrides: `REDIS_URL` (default `redis://127.0.0.1:6379`),
`REDIS_PERSISTENCE_QUEUE` (default `transaction_queue`),
`REDIS_PERSISTENCE_STATE` (default `.redis-persistence-probe.json`),
`PROBE_TIMEOUT_MS` (default `30000`). Keep the queue name identical across both
phases — the state file records it and `verify` rejects a mismatch.

The job runs on every push to `main`, and on PRs that touch
`docker-compose.yml`, `docker-compose.override.yml`, the probe script, the
dependency manifests, or `ci.yml` itself.

`tests/redis-persistence.config.test.ts` guards the declarative half of this —
that `docker-compose.yml` still declares AOF and the named volume, and that the
CI job is still wired to `restart redis` (never `down -v`) and to run both probe
phases — so a regression is caught even without Docker available.

## Anomaly detection engines

## Anomaly detection engines

There are two detection engines. Both resolve thresholds via `resolveTelemetryThresholdsForShipment`
(`telemetryThreshold.service.ts`), which merges org/shipment-type overrides with:

```ts
// src/modules/telemetry/telemetryThreshold.constants.ts
DEFAULT_TELEMETRY_THRESHOLDS = {
  maxTemp: 25,        // °C — cold-chain friendly default
  maxHumidity: 80,    // %
  minBatteryLevel: 20 // %
}
```

### Webhook path — `detectTelemetryAnomalies`

- **Trigger:** `POST /api/webhooks/iot`, inside `processIotWebhook` (`src/modules/webhooks/iot.service.ts`)
  via `setImmediate` after the 202 response (persist → anchor job → `location:update` emit first).
- **Implementation:** `detectTelemetryAnomalies` in `src/services/telemetryAnomalyDetection.ts`.
- **Types:** `TEMPERATURE_BREACH` / `HUMIDITY_BREACH` / `SHOCK_EVENT` (`shockMagnitude > 2G`) /
  `GPS_LOST` (via `detectGpsLoss`) / `BATTERY_LOW`. First match wins; the telemetry record is
  flagged (`isAnomaly=true`, `anomalyType`) inside the call.
- **Severity:** always `HIGH` on this path (`iot.service.ts` hardcodes `severity: 'HIGH'` for both
  the `anomaly:detected` socket payload and the `pushAlertJob` alert).

### Bulk-ingest path — `detectAnomaly` → `evaluateTelemetry`

- **Trigger:** `POST /api/telemetry/bulk` (JWT), inside `bulkIngestTelemetry`
  (`src/modules/telemetry/telemetry.service.ts`) via `setImmediate` per inserted record.
- **Implementation:** `detectAnomaly` (`src/modules/anomaly/anomaly.service.ts`) →
  `evaluateTelemetry` (`src/services/anomaly.service.ts`); findings are persisted as
  `Anomaly` documents (one per evaluated breach, so a single record can yield several).
- **Types:** `TEMPERATURE_EXCEEDED` / `TEMPERATURE_BELOW_MIN` / `HUMIDITY_EXCEEDED` /
  `HUMIDITY_BELOW_MIN` / `BATTERY_LOW` (no shock or GPS checks on this path).
- **Severity:** `HIGH` for temperature/humidity breaches; battery uses a depth heuristic
  (`HIGH` below half the minimum, `MEDIUM` below the minimum, else `LOW`).

## Thresholds endpoint (`GET /api/telemetry/thresholds`)

`GET /api/telemetry/thresholds` is **not** a hardcoded legacy endpoint. It routes
(`telemetry.routes.ts` → controller `getTelemetryThresholds`) to the org-threshold service
(`getOrgTelemetryThresholdsService` in `telemetryThreshold.service.ts`) and returns
`{ shipmentType, thresholds }` with the effective org/shipment-type values.

## Payload shapes (summary)

### `POST /api/webhooks/iot` (union)

**Normalized (shipment-centric):**

```json
{
  "shipmentId": "507f1f77bcf86cd799439011",
  "temperature": 22.5,
  "humidity": 55,
  "latitude": 12.34,
  "longitude": 56.78,
  "batteryLevel": 88,
  "timestamp": "2026-01-15T12:30:00.000Z"
}
```

**Sensor-centric:**

```json
{
  "sensorId": "SENSOR-42",
  "temp": 22.5,
  "humidity": 55,
  "location": { "lat": 12.34, "lng": 56.78 },
  "batteryLevel": 88,
  "timestamp": "2026-01-15T12:30:00.000Z"
}
```

Response: **202** with the standard `{ success, message, data }` envelope; `data.anchorStatus` starts as `PENDING_ANCHOR`.

### `POST /api/webhooks/stellar`

HMAC header `x-stellar-signature` required. Body: `{ id, type, paymentId, transactionHash, amount, timestamp, signature? }` where `type` ∈ `release | escrow | failed`. Response: **200**.

## Key source files

| Concern | Path |
|---------|------|
| IoT route / auth | `src/modules/webhooks/iot.routes.ts` |
| Normalize + pipeline orchestration | `src/modules/webhooks/iot.service.ts` |
| Zod union schemas | `src/modules/webhooks/iot.validation.ts` |
| Stellar settlement webhook | `src/modules/webhooks/stellar.webhook.*` |
| Queue helpers | `src/infra/redis/queue.ts`, `src/services/queue.service.ts` |
| Anchor worker | `src/workers/stellar.worker.ts` |
| Anomaly detect (webhook path) | `src/services/telemetryAnomalyDetection.ts` (`detectTelemetryAnomalies`) |
| Anomaly detect (bulk path) | `src/modules/anomaly/anomaly.service.ts` (`detectAnomaly`) + `src/services/anomaly.service.ts` (`evaluateTelemetry`) |
| Thresholds endpoint + resolution | `src/modules/telemetry/telemetryThreshold.service.ts`, `src/modules/telemetry/telemetry.controller.ts` |
| Default thresholds | `src/modules/telemetry/telemetryThreshold.constants.ts` |
