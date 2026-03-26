import '../loadEnv.js';
import { Worker, Job } from 'bullmq';
import { connectMongo } from '../infra/mongo/connection.js';
import { config } from '../config/index.js';
import { anchorTelemetryHash } from '../services/stellar.service.js';
import { updateTelemetryAnchor, markTelemetryAnchorFailed } from '../modules/telemetry/telemetry.service.js';

interface AnchorTelemetryJob {
  telemetryId: string;
  shipmentId: string;
  dataHash: string;
}

async function processStellarAnchor(job: Job<AnchorTelemetryJob>) {
  const { telemetryId, shipmentId, dataHash } = job.data;

  console.log(`[Stellar Worker] Processing job ${job.id} for telemetry ${telemetryId}`);

  try {
    // Execute Stellar transaction
    const { stellarTxHash } = await anchorTelemetryHash({
      shipmentId,
      dataHash,
    });

    console.log(`[Stellar Worker] Successfully anchored telemetry ${telemetryId} with tx ${stellarTxHash}`);

    // Update MongoDB document with the transaction hash
    await updateTelemetryAnchor(telemetryId, stellarTxHash);

    console.log(`[Stellar Worker] Updated telemetry ${telemetryId} in database`);

    return { success: true, stellarTxHash };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Stellar Worker] Failed to anchor telemetry ${telemetryId}:`, errorMessage);

    // Mark as failed in database
    await markTelemetryAnchorFailed(telemetryId, errorMessage);

    throw error; // Re-throw to trigger BullMQ retry mechanism
  }
}

async function startWorker() {
  // Connect to MongoDB
  await connectMongo(config.mongoUri);
  console.log('[Stellar Worker] Connected to MongoDB');

  // Create BullMQ worker
  const worker = new Worker<AnchorTelemetryJob>('transaction_queue', processStellarAnchor, {
    connection: {
      host: new URL(config.redisUrl).hostname,
      port: parseInt(new URL(config.redisUrl).port || '6379'),
    },
    concurrency: 5, // Process up to 5 jobs concurrently
  });

  worker.on('completed', (job) => {
    console.log(`[Stellar Worker] Job ${job.id} completed successfully`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[Stellar Worker] Job ${job?.id} failed:`, err.message);
  });

  worker.on('error', (err) => {
    console.error('[Stellar Worker] Worker error:', err);
  });

  console.log('[Stellar Worker] Started and listening for jobs on transaction_queue');

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('[Stellar Worker] SIGTERM received, closing worker...');
    await worker.close();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('[Stellar Worker] SIGINT received, closing worker...');
    await worker.close();
    process.exit(0);
  });
}

startWorker().catch((err) => {
  console.error('[Stellar Worker] Failed to start:', err);
  process.exit(1);
});
