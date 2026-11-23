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
import {
  observeConfirmationLag,
  recordIndexerCursorEvent,
  recordIndexerPoll,
} from '../infra/metrics/chainMetrics.js';
import { startMetricsServer } from '../infra/metrics/metricsServer.js';
import { logger } from '../shared/logger/logger.js';

export const STELLAR_INDEXER_QUEUE = 'stellar_indexer_queue';
export const STELLAR_INDEXER_JOB = 'poll_stellar_transactions';

const IndexerStateSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    cursor: { type: String, required: true },
    /** #1044 — ledger close time of the event `cursor` points at; drives cursor-age metrics. */
    cursorEventAt: { type: Date },
  },
  { timestamps: true }
);

export interface IndexerStateDocument {
  key: string;
  cursor: string;
  cursorEventAt?: Date;
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

export async function saveStoredCursor(
  cursor: string,
  key = 'stellar_indexer',
  eventAt?: Date
): Promise<void> {
  try {
    await IndexerStateModel.updateOne(
      { key },
      { $set: { cursor, ...(eventAt && { cursorEventAt: eventAt }) } },
      { upsert: true }
    );
  } catch {
    // Graceful fallback for un-connected DB in isolated unit tests
  }
}

/** #1044 — restores cursor-age after a restart from the persisted event time. */
export async function seedCursorAgeMetric(key = 'stellar_indexer'): Promise<void> {
  try {
    const doc = await IndexerStateModel.findOne({ key }).lean<{ cursorEventAt?: Date }>();
    recordIndexerCursorEvent(doc?.cursorEventAt);
  } catch {
    // Metrics only — never fail the indexer.
  }
}

/** #1058 — ledger confirmation threshold for the configured network. */
export function confirmationThreshold(): number {
  return config.chainConfirmations[config.stellarNetwork];
}

/**
 * Idempotently advance `confirmations`/`verified` for every anchored event class
 * (shipment anchors, status updates, milestones and escrow). Re-running at a
 * higher head only moves rows forward; confirmed rows are never downgraded.
 */
export async function reverifyAnchoredBlocks(
  adapter: ChainAdapter,
  threshold: number = confirmationThreshold()
): Promise<number> {
  let reverified = 0;
  type PendingBlock = {
    _id: string;
    ledger: number;
    confirmations?: number;
    metadata?: { eventName?: string; ledgerClosedAt?: string };
  };
  let pending: PendingBlock[];
  try {
    pending = await LedgerBlock.find({ verified: { $ne: true } }).lean<PendingBlock[]>();
  } catch {
    // Graceful fallback for un-connected DB in isolated unit tests
    return 0;
  }

  for (const block of pending) {
    const confirmations = await adapter.getConfirmationCount(block.ledger);
    const verified = confirmations >= threshold;
    if (confirmations < (block.confirmations ?? 0)) continue;
    if (!verified && confirmations === (block.confirmations ?? 0)) continue;
    await LedgerBlock.updateOne({ _id: block._id }, { $set: { confirmations, verified } });
    if (verified) {
      reverified += 1;
      // #1044 — lag from the chain event time to the moment verification succeeded.
      observeConfirmationLag(block.metadata?.eventName ?? '', block.metadata?.ledgerClosedAt);
    }
  }
  return reverified;
}

export interface IndexOptions {
  /** #1063 — report what would change without writing anything. */
  dryRun?: boolean;
  /** #1063 — advance the live indexer cursor. Replays set this to false. Default true. */
  persistCursor?: boolean;
}

export interface IndexerSummary {
  processed: number;
  /** In dry-run mode: rows that would be inserted. */
  upserted: number;
  /** #1063 — dry-run only: rows that already exist and would be refreshed. */
  existing?: number;
  lastCursor?: string;
  /** #1058 — rows promoted to verified by the reconciliation pass. */
  reverified?: number;
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
    verified: confirmations >= confirmationThreshold(),
    indexedAt: new Date().toISOString(),
  };
  const filter = {
    stellarTxHash,
    anchorStatus: TelemetryAnchorStatus.ANCHORED,
  };

  if (confirmations < confirmationThreshold()) {
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
      $or: [
        { confirmations: { $lt: confirmationThreshold() } },
        { confirmations: { $exists: false } },
      ],
    },
    { $set: { stellarTxLedger: ledger, confirmations } },
    { new: true }
  ).lean<ConfirmablePayment>();

  if (confirmations >= confirmationThreshold() && payment) {
    emitConfirmedSettlement(payment);
  }
}

async function updatePendingConfirmations(adapter: ChainAdapter): Promise<void> {
  const pendingPayments = await PaymentModel.find({
    status: PaymentStatus.RELEASED,
    stellarTxLedger: { $exists: true },
    $or: [
      { confirmations: { $lt: confirmationThreshold() } },
      { confirmations: { $exists: false } },
    ],
  }).lean<ConfirmablePayment[]>();

  for (const payment of pendingPayments) {
    await recordPaymentConfirmation(adapter, payment.stellarTxHash, payment.stellarTxLedger);
  }

  const pendingTelemetry = await Telemetry.find({
    anchorStatus: TelemetryAnchorStatus.ANCHORED,
    stellarTxLedger: { $exists: true },
    verified: { $ne: true },
    $or: [
      { 'confirmationMetadata.confirmations': { $lt: confirmationThreshold() } },
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
  initialCursor?: string,
  options: IndexOptions = {}
): Promise<IndexerSummary> {
  const { dryRun = false, persistCursor = true } = options;
  let cursor = initialCursor ?? (await getStoredCursor());
  let processed = 0;
  let upserted = 0;
  let existing = 0;

  for await (const event of adapter.streamEvents(cursor)) {
    processed += 1;
    cursor = event.id;

    // #1058 — confirmation depth is tracked for every event class, not just payments.
    const confirmations = await adapter.getConfirmationCount(event.ledger);
    const verified = confirmations >= confirmationThreshold();

    let milestoneEvent: MilestoneEvent;
    let shipmentId: string;
    /** Anchor-only; promoted to the top-level indexed `LedgerBlock.dataHash` field. */
    let dataHash: string | undefined;
    const metadata: Record<string, unknown> = {
      blockNumber: event.ledger,
      ledger: event.ledger,
      contractId: event.contract_id,
      eventId: event.id,
      eventName: event.name,
      ledgerClosedAt: event.ledger_closed_at,
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
    } else if (event.name === CHAIN_EVENT_NAMES.ESCROW_DISPUTE) {
      milestoneEvent = MilestoneEvent.DISPUTED;
      shipmentId = event.topic[1];
      metadata.paymentId = event.topic[1];
      metadata.reasonHash = event.data[0];
    } else if (event.name === CHAIN_EVENT_NAMES.ESCROW_RESOLVE) {
      milestoneEvent = MilestoneEvent.RESOLVED;
      shipmentId = event.topic[1];
      metadata.paymentId = event.topic[1];
      metadata.outcome = event.data[0];
    } else if (event.name === CHAIN_EVENT_NAMES.ESCROW_FREEZE) {
      milestoneEvent = MilestoneEvent.ESCROW_FROZEN;
      shipmentId = event.topic[1];
      metadata.paymentId = event.topic[1];
      metadata.frozen = true;
    } else if (event.name === CHAIN_EVENT_NAMES.ESCROW_UNFREEZE) {
      milestoneEvent = MilestoneEvent.ESCROW_UNFROZEN;
      shipmentId = event.topic[1];
      metadata.paymentId = event.topic[1];
      metadata.frozen = false;
    } else {
      continue;
    }

    if (dryRun) {
      const found = await LedgerBlock.exists({ transactionHash: event.tx_hash });
      if (found) existing += 1;
      else upserted += 1;
      continue;
    }

    const res = await LedgerBlock.updateOne(
      { transactionHash: event.tx_hash },
      {
        $setOnInsert: {
          shipmentId,
          transactionHash: event.tx_hash,
          actor: 'stellar-indexer',
        },
        // milestoneEvent is in $set only: Mongo rejects the same path in both operators.
        // dataHash lives in $set (not $setOnInsert) so re-indexing backfills rows
        // written before it was promoted; Mongo rejects a path in both operators.
        $set: {
          milestoneEvent,
          metadata,
          confirmations,
          verified,
          ...(dataHash !== undefined && { dataHash }),
        },
      },
      { upsert: true }
    );

    if ((res as { upsertedCount?: number } | undefined)?.upsertedCount) {
      upserted += 1;
      // #1044 — already-confirmed on first sight; otherwise reverifyAnchoredBlocks observes it later.
      if (verified) observeConfirmationLag(event.name, event.ledger_closed_at);
    }

    if (event.name === CHAIN_EVENT_NAMES.ANCHOR) {
      await recordTelemetryConfirmation(adapter, event.tx_hash, event.ledger);
    } else if (event.name === CHAIN_EVENT_NAMES.ESCROW_RELEASE) {
      await recordPaymentConfirmation(adapter, event.tx_hash, event.ledger);
    }

    if (cursor && persistCursor) {
      await saveStoredCursor(cursor, undefined, new Date(event.ledger_closed_at));
      recordIndexerCursorEvent(event.ledger_closed_at);
    }
  }

  if (dryRun) {
    return { processed, upserted, existing, lastCursor: cursor };
  }

  await updatePendingConfirmations(adapter);
  const reverified = await reverifyAnchoredBlocks(adapter);

  return { processed, upserted, lastCursor: cursor, reverified };
}

async function processIndexerJob(_job: Job): Promise<IndexerSummary> {
  const adapter = getChainAdapter();
  await seedCursorAgeMetric();
  const summary = await indexStellarTransactions(adapter);
  recordIndexerPoll();
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
  startMetricsServer();
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
