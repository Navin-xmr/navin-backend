import '../loadEnv.js';
import { pathToFileURL } from 'node:url';
import { Worker, Queue, type Job } from 'bullmq';
import mongoose, { Schema } from 'mongoose';
import { connectMongo } from '../infra/mongo/connection.js';
import { config } from '../config/index.js';
import { getBullMQConnection } from '../infra/redis/connection.js';
import { LedgerBlock } from '../modules/ledger/ledger.model.js';
import { PaymentModel, PaymentStatus } from '../modules/payments/payments.model.js';
import { Telemetry, TelemetryAnchorStatus } from '../modules/telemetry/telemetry.model.js';
import { emitPaymentStatusChange } from '../infra/socket/io.js';
import { MilestoneEvent } from '../shared/types/shipment.js';
import { CHAIN_EVENT_NAMES } from '../shared/types/chain.js';
import type { ChainAdapter } from '../services/chain/types.js';
import { getChainAdapter } from '../services/chain/factory.js';
import { confirmAnchoredTelemetry } from '../modules/telemetry/telemetry.confirmation.js';
import { logger } from '../shared/logger/logger.js';

export const STELLAR_INDEXER_QUEUE = 'stellar_indexer_queue';
export const STELLAR_INDEXER_JOB = 'poll_stellar_transactions';

const IndexerStateSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    cursor: { type: String, required: true },
  },
  { timestamps: true }
);

export interface IndexerStateDocument {
  key: string;
  cursor: string;
}

export const IndexerStateModel =
  mongoose.models.IndexerState ||
  mongoose.model<IndexerStateDocument>('IndexerState', IndexerStateSchema);

export async function getStoredCursor(key = 'stellar_indexer'): Promise<string | undefined> {
  try {
    const doc = await IndexerStateModel.findOne({ key }).lean<{ key: string; cursor: string }>();
    return doc?.cursor;
  } catch {
    return undefined;
  }
}

export async function saveStoredCursor(cursor: string, key = 'stellar_indexer'): Promise<void> {
  try {
    await IndexerStateModel.updateOne({ key }, { $set: { cursor } }, { upsert: true });
  } catch {
    // Graceful fallback for un-connected DB in isolated unit tests
  }
}

export interface IndexerSummary {
  processed: number;
  upserted: number;
  lastCursor?: string;
}

interface ConfirmablePayment {
  _id: { toString(): string };
  shipmentId: { toString(): string };
  status: PaymentStatus;
  amount: number;
  stellarTxHash: string;
  stellarTxLedger: number;
}

interface ConfirmableTelemetry {
  _id: { toString(): string };
  stellarTxHash: string;
  stellarTxLedger: number;
}

function emitConfirmedSettlement(payment: ConfirmablePayment): void {
  emitPaymentStatusChange(payment.shipmentId.toString(), {
    paymentId: payment._id.toString(),
    shipmentId: payment.shipmentId.toString(),
    oldStatus: payment.status,
    newStatus: payment.status,
    amount: payment.amount,
    txHash: payment.stellarTxHash,
    timestamp: new Date().toISOString(),
  });
}

async function recordTelemetryConfirmation(
  adapter: ChainAdapter,
  stellarTxHash: string,
  ledger: number
): Promise<void> {
  const confirmations = await adapter.getConfirmationCount(ledger);
  const confirmationMetadata = {
    ledger,
    confirmations,
    verified: confirmations >= 3,
    indexedAt: new Date().toISOString(),
  };
  const filter = {
    stellarTxHash,
    anchorStatus: TelemetryAnchorStatus.ANCHORED,
  };

  if (confirmations < 3) {
    await Telemetry.updateOne(filter, {
      $set: { stellarTxLedger: ledger, confirmationMetadata },
    });
    return;
  }

  const verified = await Telemetry.findOneAndUpdate(
    filter,
    {
      $set: {
        stellarTxLedger: ledger,
        confirmationMetadata,
        anchorStatus: TelemetryAnchorStatus.VERIFIED,
        verified: true,
      },
    },
    { new: true }
  ).lean<{ _id: { toString(): string } }>();

  if (verified) {
    logger.info(
      { telemetryId: verified._id.toString(), confirmations },
      'Telemetry anchor verified on Stellar'
    );
  }
}

async function recordPaymentConfirmation(
  adapter: ChainAdapter,
  stellarTxHash: string,
  ledger: number
): Promise<void> {
  const confirmations = await adapter.getConfirmationCount(ledger);
  const payment = await PaymentModel.findOneAndUpdate(
    {
      stellarTxHash,
      status: PaymentStatus.RELEASED,
      $or: [{ confirmations: { $lt: 3 } }, { confirmations: { $exists: false } }],
    },
    { $set: { stellarTxLedger: ledger, confirmations } },
    { new: true }
  ).lean<ConfirmablePayment>();

  if (confirmations >= 3 && payment) {
    emitConfirmedSettlement(payment);
  }
}

async function updatePendingConfirmations(adapter: ChainAdapter): Promise<void> {
  const pendingPayments = await PaymentModel.find({
    status: PaymentStatus.RELEASED,
    stellarTxLedger: { $exists: true },
    $or: [{ confirmations: { $lt: 3 } }, { confirmations: { $exists: false } }],
  }).lean<ConfirmablePayment[]>();

  for (const payment of pendingPayments) {
    await recordPaymentConfirmation(adapter, payment.stellarTxHash, payment.stellarTxLedger);
  }

  const pendingTelemetry = await Telemetry.find({
    anchorStatus: TelemetryAnchorStatus.ANCHORED,
    stellarTxLedger: { $exists: true },
    verified: { $ne: true },
    $or: [
      { 'confirmationMetadata.confirmations': { $lt: 3 } },
      { 'confirmationMetadata.confirmations': { $exists: false } },
    ],
  }).lean<ConfirmableTelemetry[]>();

  for (const telemetry of pendingTelemetry) {
    await recordTelemetryConfirmation(adapter, telemetry.stellarTxHash, telemetry.stellarTxLedger);
  }
}

/**
 * Event-driven indexer pipeline consuming spec events from ChainAdapter.streamEvents().
 * Zero string-inference or memo-guessing. Persists event cursor across restarts.
 */
export async function indexStellarTransactions(
  adapter: ChainAdapter = getChainAdapter(),
  initialCursor?: string
): Promise<IndexerSummary> {
  let cursor = initialCursor ?? (await getStoredCursor());
  let processed = 0;
  let upserted = 0;

  for await (const event of adapter.streamEvents(cursor)) {
    processed += 1;
    cursor = event.id;

    let milestoneEvent: MilestoneEvent;
    let shipmentId: string;
    /** Anchor-only; promoted to the top-level indexed `LedgerBlock.dataHash` field. */
    let dataHash: string | undefined;
    const metadata: Record<string, unknown> = {
      blockNumber: event.ledger,
      ledger: event.ledger,
      contractId: event.contract_id,
      eventId: event.id,
      indexedAt: new Date().toISOString(),
    };

    if (event.name === CHAIN_EVENT_NAMES.ANCHOR) {
      milestoneEvent = MilestoneEvent.IN_TRANSIT;
      shipmentId = event.topic[1];
      dataHash = event.data[0];
      metadata.dataHash = dataHash;
    } else if (event.name === CHAIN_EVENT_NAMES.ESCROW_INIT) {
      milestoneEvent = MilestoneEvent.SETTLEMENT_INITIATED;
      shipmentId = event.data[0];
      metadata.paymentId = event.topic[1];
      metadata.payer = event.data[1];
      metadata.payee = event.data[2];
      metadata.token = event.data[3];
      metadata.amount = event.data[4];
    } else if (event.name === CHAIN_EVENT_NAMES.ESCROW_RELEASE) {
      milestoneEvent = MilestoneEvent.SETTLEMENT_COMPLETED;
      shipmentId = event.topic[1];
      metadata.paymentId = event.topic[1];
      metadata.proofHash = event.data[0];
      metadata.payee = event.data[1];
      metadata.amount = event.data[2];
    } else {
      continue;
    }

    const res = await LedgerBlock.updateOne(
      { transactionHash: event.tx_hash },
      {
        $setOnInsert: {
          shipmentId,
          milestoneEvent,
          transactionHash: event.tx_hash,
          actor: 'stellar-indexer',
        },
        // dataHash lives in $set (not $setOnInsert) so re-indexing backfills rows
        // written before it was promoted; Mongo rejects a path in both operators.
        $set: {
          milestoneEvent,
          metadata,
          ...(dataHash !== undefined && { dataHash }),
        },
      },
      { upsert: true }
    );

    if ((res as { upsertedCount?: number }).upsertedCount) {
      upserted += 1;
    }

    if (event.name === CHAIN_EVENT_NAMES.ANCHOR) {
      await recordTelemetryConfirmation(adapter, event.tx_hash, event.ledger);
    } else if (event.name === CHAIN_EVENT_NAMES.ESCROW_RELEASE) {
      await recordPaymentConfirmation(adapter, event.tx_hash, event.ledger);
    }

    if (cursor) {
      await saveStoredCursor(cursor);
    }
  }

  await updatePendingConfirmations(adapter);

  return { processed, upserted, lastCursor: cursor };
}

async function processIndexerJob(_job: Job): Promise<IndexerSummary> {
  const adapter = getChainAdapter();
  const summary = await indexStellarTransactions(adapter);
  logger.info(summary, 'Stellar indexer event stream cycle complete');

  // Confirmation tracking for anchored telemetry (#818). Runs after indexing and
  // never fails the indexer cycle.
  if (
    typeof adapter.getLatestLedger === 'function' &&
    typeof adapter.getTransactionLedger === 'function'
  ) {
    try {
      const confirmation = await confirmAnchoredTelemetry({
        getLatestLedger: () => adapter.getLatestLedger!(),
        getTransactionLedger: txHash => adapter.getTransactionLedger!(txHash),
      });
      logger.info(confirmation, 'Telemetry confirmation cycle complete');
    } catch (err) {
      logger.error({ err }, 'Telemetry confirmation cycle failed');
    }
  }

  return summary;
}

export async function startStellarIndexerWorker(): Promise<Worker> {
  await connectMongo(config.mongoUri);

  const queue = new Queue(STELLAR_INDEXER_QUEUE, { connection: getBullMQConnection() });
  await queue.add(
    STELLAR_INDEXER_JOB,
    {},
    {
      jobId: STELLAR_INDEXER_JOB,
      repeat: { every: 30_000 },
      attempts: 5,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: 100,
      removeOnFail: 100,
    }
  );

  const worker = new Worker(STELLAR_INDEXER_QUEUE, async job => processIndexerJob(job), {
    connection: getBullMQConnection(),
    concurrency: 1,
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Stellar indexer job failed');
  });

  worker.on('completed', job => {
    logger.info({ jobId: job.id }, 'Stellar indexer job completed');
  });

  return worker;
}

const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  startStellarIndexerWorker().catch(err => {
    logger.error({ err }, 'Stellar indexer worker bootstrap failed');
    process.exitCode = 1;
  });
}
