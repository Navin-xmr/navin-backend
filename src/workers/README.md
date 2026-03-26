# Background Workers

This directory contains BullMQ workers that process background jobs asynchronously.

## Stellar Worker

The Stellar worker (`stellar.worker.ts`) processes Stellar blockchain anchoring operations in the background, decoupling them from HTTP request/response cycles.

### Purpose

When IoT sensors send telemetry data to the `/api/webhooks/iot` endpoint, the data is immediately saved to MongoDB with a `PENDING_ANCHOR` status and a job is queued. The Stellar worker then processes these jobs asynchronously, anchoring the data hash to the Stellar Testnet.

### Benefits

1. **Fast HTTP Responses**: API responds with 202 Accepted immediately
2. **Resilience**: Automatic retries on Stellar network failures
3. **Scalability**: Multiple workers can process jobs concurrently
4. **Reliability**: Jobs persist in Redis queue even if worker crashes

### Running the Worker

```bash
# Development
npm run worker:stellar

# Production
node dist/workers/stellar.worker.js
```

### Configuration

The worker uses the following environment variables:
- `MONGO_URI`: MongoDB connection string
- `REDIS_URL`: Redis connection string
- `STELLAR_SECRET_KEY`: Stellar account secret key
- `STELLAR_NETWORK`: Network to use (testnet or public)

### Job Processing

1. **Job Data**:
   ```typescript
   {
     telemetryId: string;  // MongoDB document ID
     shipmentId: string;   // Shipment reference
     dataHash: string;     // SHA-256 hash of telemetry data
   }
   ```

2. **Processing Steps**:
   - Fetch job from `transaction_queue`
   - Call `anchorTelemetryHash()` to submit Stellar transaction
   - Update MongoDB document with `stellarTxHash` and `ANCHORED` status
   - On failure: Mark as `ANCHOR_FAILED` and retry (up to 3 attempts)

3. **Retry Strategy**:
   - Attempts: 3
   - Backoff: Exponential (2s, 4s, 8s)
   - Failures are logged and stored in MongoDB

### Monitoring

The worker logs all operations:
```
[Stellar Worker] Started and listening for jobs on transaction_queue
[Stellar Worker] Processing job 123 for telemetry abc
[Stellar Worker] Successfully anchored telemetry abc with tx xyz
[Stellar Worker] Job 123 completed successfully
```

### Graceful Shutdown

The worker handles SIGTERM and SIGINT signals gracefully:
```bash
# Stop worker
kill -SIGTERM <pid>
```

### Testing

Run worker tests:
```bash
npm test -- stellar.worker.test.ts
```

### Production Deployment

For production, consider:
1. Running multiple worker instances for redundancy
2. Using a process manager (PM2, systemd)
3. Monitoring job queue metrics
4. Setting up alerts for failed jobs
5. Implementing dead letter queues for permanently failed jobs

### Example: PM2 Configuration

```json
{
  "apps": [{
    "name": "stellar-worker",
    "script": "dist/workers/stellar.worker.js",
    "instances": 2,
    "exec_mode": "cluster",
    "env": {
      "NODE_ENV": "production"
    }
  }]
}
```
