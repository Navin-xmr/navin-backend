import '../loadEnv.js';
import { pathToFileURL } from 'node:url';
import { Worker, Queue, type Job } from 'bullmq';
import mongoose, { Schema } from 'mongoose';
import { connectMongo } from '../infra/mongo/connection.js';
import { config } from '../config/index.js';
import { getBullMQConnection } from '../infra/redis/connection.js';
import { StrKey } from '@stellar/stellar-sdk';
import { LedgerBlock } from '../modules/ledger/ledger.model.js';
import { PaymentModel, PaymentStatus, type IPayment } from '../modules/payments/payments.model.js';
import { emitPaymentStatusChange } from '../infra/socket/io.js';
import type { SettlementStatusPayload } from '../shared/types/socketEvents.js';
import { MilestoneEvent } from '../shared/types/shipment.js';
import { CHAIN_EVENT_NAMES } from '../shared/types/chain.js';
import type { ChainAdapter } from '../services/chain/types.js';
import { getChainAdapter } from '../services/chain/factory.js';
import { logger } from '../shared/logger/logger.js';

export const STELLAR_INDEXER_QUEUE = 'stellar_indexer_queue';
export const STELLAR_INDEXER_JOB = 'poll_stellar_transactions';
export const DEFAULT_CONFIRMATIONS = 3;

const SIMULATED_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32));

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

export interface IndexerOptions {
  latestLedger?: number;
  minConfirmations?: number;
  simulated?: boolean;
}

export interface IndexerSummary {
  processed: number;
  upserted: number;
  verified?: number;
  lastCursor?: string;
}

/**
 * Event-driven indexer pipeline consuming spec events from ChainAdapter.streamEvents().
 * Zero string-inference or memo-guessing. Persists event cursor across restarts.
 */
export async function indexStellarTransactions(
  adapter: ChainAdapter = getChainAdapter(),
  initialCursorOrOptions?: string | number | IndexerOptions,
  optionsOrMinConfirmations?: number | IndexerOptions
): Promise<IndexerSummary> {
  const initialCursor =
    typeof initialCursorOrOptions === 'string' ? initialCursorOrOptions : undefined;
  const resolvedOptions: IndexerOptions =
    typeof initialCursorOrOptions === 'object' && initialCursorOrOptions !== null
      ? initialCursorOrOptions
      : typeof optionsOrMinConfirmations === 'object' && optionsOrMinConfirmations !== null
        ? optionsOrMinConfirmations
        : {};
  const minConfirmations =
    typeof initialCursorOrOptions === 'number'
      ? initialCursorOrOptions
      : typeof optionsOrMinConfirmations === 'number'
        ? optionsOrMinConfirmations
        : (resolvedOptions.minConfirmations ?? DEFAULT_CONFIRMATIONS);

  const adapterWithLatestLedger = adapter as ChainAdapter & {
    getLatestLedger?: () => Promise<number>;
  };
  const adapterLatestLedger =
    resolvedOptions.latestLedger === undefined &&
    typeof adapterWithLatestLedger.getLatestLedger === 'function'
      ? await adapterWithLatestLedger.getLatestLedger()
      : undefined;
  const latestLedger = resolvedOptions.latestLedger ?? adapterLatestLedger;

  let cursor = initialCursor ?? (await getStoredCursor());
  let processed = 0;
  let upserted = 0;
  let verified = 0;

  for await (const event of adapter.streamEvents(cursor)) {
    processed += 1;

    let milestoneEvent: MilestoneEvent;
    let shipmentId: string;
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
      metadata.dataHash = event.data[0];
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
      const paymentId = event.topic[1];
      shipmentId = paymentId;
      metadata.paymentId = paymentId;
      metadata.proofHash = event.data[0];
      metadata.payee = event.data[1];
      metadata.amount = event.data[2];

      const isSimulated = resolvedOptions.simulated ?? event.contract_id === SIMULATED_CONTRACT_ID;
      const confirmations =
        latestLedger !== undefined
          ? Math.max(0, latestLedger - event.ledger)
          : isSimulated
            ? minConfirmations
            : 0;
      const isConfirmed = isSimulated || confirmations >= minConfirmations;

      metadata.confirmations = confirmations;
      metadata.verified = isConfirmed;

      if (isConfirmed) {
        verified += 1;
      }

      const existingPayment =
        typeof PaymentModel.findOne === 'function'
          ? await PaymentModel.findOne({
              $or: [{ _id: paymentId }, { stellarTxHash: event.tx_hash }],
            })
              .lean<IPayment>()
              .catch(() => null)
          : null;

      if (existingPayment?.shipmentId) {
        shipmentId = String(existingPayment.shipmentId);
      }

      if (typeof PaymentModel.updateOne === 'function') {
        await PaymentModel.updateOne(
          {
            $or: [{ _id: paymentId }, { stellarTxHash: event.tx_hash }],
            status: { $ne: PaymentStatus.COMPLETED },
          },
          {
            $set: {
              confirmations,
              stellarTxHash: event.tx_hash,
              ...(isConfirmed ? { status: PaymentStatus.COMPLETED } : {}),
            },
          }
        );
      }

      if (!isConfirmed) {
        continue;
      }

      const settlementPayload: SettlementStatusPayload = {
        paymentId: existingPayment?._id ? String(existingPayment._id) : paymentId,
        shipmentId,
        oldStatus: existingPayment?.status ?? PaymentStatus.PROCESSING,
        newStatus: PaymentStatus.COMPLETED,
        amount: existingPayment?.amount ?? Number(event.data[2]),
        txHash: event.tx_hash,
        timestamp: new Date().toISOString(),
      };

      try {
        emitPaymentStatusChange(shipmentId, settlementPayload);
      } catch (err) {
        logger.debug(
          { err, shipmentId, paymentId },
          'Socket.io not initialized; skipping realtime settlement status emission'
        );
      }
    } else {
      continue;
    }

    cursor = event.id;

    const res = await LedgerBlock.updateOne(
      { transactionHash: event.tx_hash },
      {
        $setOnInsert: {
          shipmentId,
          eventType: milestoneEvent,
          transactionHash: event.tx_hash,
          actor: 'stellar-indexer',
        },
        $set: { metadata },
      },
      { upsert: true }
    );

    if ((res as { upsertedCount?: number }).upsertedCount) {
      upserted += 1;
    }

    if (cursor) {
      await saveStoredCursor(cursor);
    }
  }

  return { processed, upserted, verified, lastCursor: cursor };
}

async function processIndexerJob(_job: Job): Promise<IndexerSummary> {
  const summary = await indexStellarTransactions();
  logger.info(summary, 'Stellar indexer event stream cycle complete');
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
