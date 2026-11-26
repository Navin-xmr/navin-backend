/**
 * #997 — create_shipment outbox worker.
 *
 * Submits pending create_shipment outbox rows with bounded retries and
 * idempotency. Outbox state lives on the shipment document itself, so the DB
 * row and its enqueue are committed atomically (no orphan states). Claiming a
 * row is a compare-and-set on `pending_chain`, so only one worker submits it.
 */
import { Shipment } from '../modules/shipments/shipments.model.js';
import { getChainAdapter, getChainActorAddress } from '../services/chain/factory.js';
import { generateDataHash } from '../shared/utils/crypto.js';
import { logger } from '../shared/logger/logger.js';

const MAX_ATTEMPTS = 5;
const BACKOFF_MS = 2000;

/** Delay before a failed submission may be retried. Exported for unit tests. */
export function retryDelayMs(attempts: number, base = BACKOFF_MS): number {
  return base * 2 ** Math.max(0, attempts - 1);
}

/**
 * One worker pass. Returns the number of rows claimed (successful or failed).
 * A chain failure never deletes the row: it is retried with exponential backoff
 * until MAX_ATTEMPTS, then left in `failed` for inspection/replay.
 */
export async function processCreateShipmentOutbox(batchSize = 10): Promise<number> {
  const now = new Date();
  const candidates = await Shipment.find({
    'chainOutbox.status': 'pending_chain',
    'chainOutbox.availableAt': { $lte: now },
  })
    .limit(batchSize)
    .lean();

  let claimed = 0;
  for (const shipment of candidates) {
    const outbox = shipment.chainOutbox;
    if (!outbox) continue;

    const claim = await Shipment.updateOne(
      {
        _id: shipment._id,
        'chainOutbox.status': 'pending_chain',
        'chainOutbox.idempotencyKey': outbox.idempotencyKey,
      },
      { $set: { 'chainOutbox.status': 'processing' } }
    );
    if (claim.matchedCount !== 1) continue; // another worker claimed it
    claimed += 1;

    try {
      const receipt = await getChainAdapter().anchorEvent({
        shipment_id: shipment._id.toString(),
        data_hash: generateDataHash({
          shipmentId: shipment._id.toString(),
          trackingNumber: shipment.trackingNumber,
          origin: shipment.origin,
          destination: shipment.destination,
          idempotencyKey: outbox.idempotencyKey,
        }),
        actor: getChainActorAddress(),
      });

      await Shipment.updateOne(
        { _id: shipment._id, 'chainOutbox.idempotencyKey': outbox.idempotencyKey },
        {
          $set: {
            'chainOutbox.status': 'anchored',
            'chainOutbox.txHash': receipt.txHash,
            'chainOutbox.ledger': receipt.ledger,
            stellarTxHash: receipt.txHash,
          },
        }
      );
    } catch (err) {
      const attempts = outbox.attempts + 1;
      const exhausted = attempts >= MAX_ATTEMPTS;
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(
        {
          err,
          shipmentId: shipment._id.toString(),
          attempts,
          idempotencyKey: outbox.idempotencyKey,
        },
        'create_shipment outbox submission failed'
      );
      await Shipment.updateOne(
        { _id: shipment._id, 'chainOutbox.idempotencyKey': outbox.idempotencyKey },
        {
          $set: {
            'chainOutbox.status': exhausted ? 'failed' : 'pending_chain',
            'chainOutbox.attempts': attempts,
            'chainOutbox.lastError': message,
            'chainOutbox.availableAt': new Date(Date.now() + retryDelayMs(attempts)),
          },
        }
      );
    }
  }
  return claimed;
}

/** Long-running entry point (wired via `npm run worker:chain-outbox`). */
export function startChainOutboxWorker(intervalMs = 5000): NodeJS.Timeout {
  const tick = async () => {
    try {
      await processCreateShipmentOutbox();
    } catch (err) {
      logger.error({ err }, 'create_shipment outbox worker pass failed');
    }
  };
  void tick();
  return setInterval(tick, intervalMs);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const timer = startChainOutboxWorker();
  logger.info('create_shipment outbox worker started');
  process.on('SIGTERM', () => {
    clearInterval(timer);
  });
}
