import '../loadEnv.js';
import { Worker, type Job } from 'bullmq';
import { connectMongo } from '../infra/mongo/connection.js';
import { pushChainWebhookDeadLetter } from '../infra/redis/queue.js';
import { getBullMQConnection } from '../infra/redis/connection.js';
import { config } from '../config/index.js';
import { deliverChainWebhook } from '../modules/webhooks/chainWebhook.service.js';
import { logger } from '../shared/logger/logger.js';
import type {
  ChainWebhookDeadLetterData,
  ChainWebhookJobData,
} from '../shared/types/chainWebhook.js';
import { CHAIN_WEBHOOK_RETRY_POLICY } from '../shared/types/chainWebhook.js';

async function moveToDeadLetter(job: Job<ChainWebhookJobData>, error: Error): Promise<void> {
  const configuredAttempts = job.opts.attempts ?? CHAIN_WEBHOOK_RETRY_POLICY.attempts;
  if (job.attemptsMade < configuredAttempts) return;

  const deadLetter: ChainWebhookDeadLetterData = {
    job: job.data,
    attemptsMade: job.attemptsMade,
    errorMessage: error.message,
    failedAt: new Date().toISOString(),
  };
  try {
    await pushChainWebhookDeadLetter(deadLetter);
    logger.error(
      {
        metric: 'chain_webhook_delivery_dead_letter_total',
        jobId: job.id,
        subscriptionId: job.data.subscriptionId,
        eventName: job.data.payload.eventName,
        attemptsMade: job.attemptsMade,
      },
      'Chain webhook exhausted retries and was moved to the dead-letter queue'
    );
  } catch (deadLetterError) {
    logger.error(
      { jobId: job.id, err: deadLetterError },
      'Failed to persist chain webhook in the dead-letter queue'
    );
  }
}

async function processDelivery(job: Job<ChainWebhookJobData>): Promise<void> {
  await deliverChainWebhook(job.data);
}

async function startWorker(): Promise<void> {
  await connectMongo(config.mongoUri);
  const worker = new Worker<ChainWebhookJobData>('chain_webhook_queue', processDelivery, {
    connection: getBullMQConnection(),
    concurrency: 10,
  });
  worker.on('failed', (job, error) => {
    if (job)
      void moveToDeadLetter(job, error).catch(err => {
        logger.error({ jobId: job.id, err }, 'Chain webhook dead-letter handler failed');
      });
  });
  worker.on('error', error => logger.error({ err: error }, 'Chain webhook worker error'));

  logger.info('Chain webhook delivery worker started');
  const shutdown = async () => {
    await worker.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startWorker().catch(error => {
  logger.error({ err: error }, 'Failed to start chain webhook worker');
  process.exit(1);
});
