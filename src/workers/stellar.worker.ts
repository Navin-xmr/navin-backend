import '../loadEnv.js';
import { Worker, Job } from 'bullmq';
import { connectMongo } from '../infra/mongo/connection.js';
import { config } from '../config/index.js';
import { getChainActorAddress, getChainAdapter } from '../services/chain/factory.js';
import {
  updateTelemetryAnchor,
  markTelemetryAnchorFailed,
} from '../modules/telemetry/telemetry.service.js';
import { AppError, ErrorCodes } from '../shared/http/errors.js';
import { startMetricsServer } from '../infra/metrics/metricsServer.js';
import { logger } from '../shared/logger/logger.js';

interface AnchorTelemetryJob {
  telemetryId: string;
  shipmentId: string;
  dataHash: string;
}

/** Serializes an error to log-safe primitives only — never the raw object or stack,
 *  which can carry secrets, SDK payloads, or internal paths. */
function safeError(err: unknown): { message: string; code?: string } {
  if (err instanceof Error) {
    const out: { message: string; code?: string } = { message: err.message };
    const typed = err as { code?: string };
    if (typed.code) {
      out.code = typed.code;
    }
    return out;
  }
  return { message: String(err) };
}

async function processStellarAnchor(job: Job<AnchorTelemetryJob>) {
  const { telemetryId, shipmentId, dataHash } = job.data;

  logger.info({ jobId: job.id, telemetryId }, 'Processing stellar anchor job');

  try {
    // Anchor through the ChainAdapter port (submissions are serialized per signing account)
    const { txHash: stellarTxHash } = await getChainAdapter().anchorEvent({
      shipment_id: shipmentId,
      data_hash: dataHash,
      actor: getChainActorAddress(),
    });

    logger.info({ telemetryId, stellarTxHash }, 'Telemetry anchored on Stellar');

    // Update MongoDB document with the transaction hash
    await updateTelemetryAnchor(telemetryId, stellarTxHash);

    logger.info({ telemetryId }, 'Telemetry anchor persisted in MongoDB');

    return { success: true, stellarTxHash };
  } catch (error) {
    const errorCode = error instanceof AppError ? error.code : ErrorCodes.CHAIN_UNKNOWN;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ telemetryId, errorCode, errorMessage }, 'Failed to anchor telemetry');

    await markTelemetryAnchorFailed(telemetryId, errorCode);

    throw error;
  }
}

async function startWorker() {
  // Fail fast on a misconfigured SOROBAN_ADAPTER instead of failing every job
  getChainAdapter();

  startMetricsServer();

  // Connect to MongoDB
  await connectMongo(config.mongoUri);
  logger.info('Stellar worker connected to MongoDB');

  // Create BullMQ worker
  const worker = new Worker<AnchorTelemetryJob>('transaction_queue', processStellarAnchor, {
    connection: {
      host: new URL(config.redisUrl).hostname,
      port: parseInt(new URL(config.redisUrl).port || '6379'),
    },
    concurrency: 5, // Safe: the adapter serializes submissions per signing account
  });

  worker.on('completed', job => {
    logger.info({ jobId: job.id }, 'Stellar worker job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, ...safeError(err) }, 'Stellar worker job failed');
  });

  worker.on('error', err => {
    logger.error({ ...safeError(err) }, 'Stellar worker error');
  });

  logger.info('Stellar worker listening on transaction_queue');

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, closing stellar worker');
    await worker.close();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    logger.info('SIGINT received, closing stellar worker');
    await worker.close();
    process.exit(0);
  });
}

startWorker().catch(err => {
  logger.error({ ...safeError(err) }, 'Failed to start stellar worker');
  process.exit(1);
});
