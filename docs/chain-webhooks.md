# Chain webhooks

Organization administrators can register external subscribers at `/api/webhooks/chain/subscriptions`. Subscriptions are scoped to the shipment's enterprise and logistics organizations; each subscription selects one or more v1 adapter events:

| `eventName` | Meaning                         |
| ----------- | ------------------------------- |
| `anchor`    | Shipment hash anchor confirmed  |
| `esc_init`  | Escrow initialization confirmed |
| `esc_rel`   | Escrow release confirmed        |

This catalogue follows the current backend `CHAIN_SPEC_VERSION = 1.0.0-draft`; it does not claim that the backend indexer accepts the contracts v2 event variants yet. Payload schema versioning is independent of the Soroban contract spec:

```json
{
  "eventId": "0002200479567253504-0000000001",
  "eventName": "anchor",
  "shipmentReference": "NVN-123456",
  "txHash": "2e7d2c03a9507ae265ecf5b5356885a53393a2029d241394997265a1a25aefc6",
  "ledger": 512345,
  "schemaVersion": 1,
  "occurredAt": "2026-09-27T10:15:30Z",
  "dataHash": "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb"
}
```

`dataHash` is omitted for events that do not carry one. The signature secret is generated per subscription and returned only on creation; it is encrypted at rest using `CHAIN_WEBHOOK_ENCRYPTION_KEY` (32 bytes encoded as 64 hex characters).

## Signature verification

Each delivery includes `X-Navin-Timestamp`, `X-Navin-Signature`, and `X-Navin-Event-Id`. The signature is `sha256=` followed by the lowercase hex HMAC-SHA256 of:

```text
<timestamp>.<exact raw HTTP request body>
```

Verify against the raw body bytes before parsing JSON, compare digests in constant time, and reject timestamps outside a short replay window (for example, five minutes). The event ID is stable across delivery retries; deduplicate it on the subscriber.

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function verifyNavinWebhook(rawBody, timestamp, signature, secret, now = Date.now()) {
  const seconds = Number(timestamp);
  if (!Number.isInteger(seconds) || Math.abs(Math.floor(now / 1000) - seconds) > 300) return false;
  const expected = Buffer.from(
    `sha256=${createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex')}`
  );
  const supplied = Buffer.from(signature);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
```

## Delivery, retries, and dead letters

Confirmed events are enqueued to BullMQ `chain_webhook_queue` with a stable event/subscription job ID. Delivery requires HTTPS, rejects redirects, resolves and pins a public IP address for the TLS connection, and rejects private/reserved address ranges. Network errors, timeouts, and non-2xx responses are retried up to eight total attempts with exponential backoff starting at one second. A final failure is copied into the persistent `chain_webhook_dead_letter_queue`; worker logs emit `chain_webhook_delivery_dead_letter_total` and include the subscription, event, and exhausted attempt count. Inspect these failed jobs and worker logs during incident response. Do not log or persist the raw signing secret in job data.

Manage destinations and rotation by revoking and recreating a subscription. Routes and envelope schemas are in [`docs/swagger.yaml`](./swagger.yaml). For the v2 frontend's direct RPC verification flow, see [frontend-chain-verification.md](./frontend-chain-verification.md) and [the contracts guide](https://github.com/Navin-xmr/navin-contracts/blob/main/docs/FRONTEND_VERIFICATION.md).
