import { Worker, Job } from 'bullmq';
import { redisConnection } from '../infra/redis/connection.js';
import { AlertPayload } from '../services/queue.service.js';

async function processAlert(job: Job<AlertPayload>): Promise<void> {
  const { type, message, shipmentId } = job.data;

  await new Promise((resolve) => setTimeout(resolve, 1000));

  const border = '─'.repeat(50);
  console.log(`\x1b[36m┌${border}┐\x1b[0m`);
  console.log(`\x1b[36m│\x1b[0m \x1b[1m\x1b[33m[Alert Worker]\x1b[0m Alert sent!`);
  console.log(`\x1b[36m│\x1b[0m  Type:       \x1b[35m${type}\x1b[0m`);
  console.log(`\x1b[36m│\x1b[0m  Shipment:   \x1b[32m${shipmentId}\x1b[0m`);
  console.log(`\x1b[36m│\x1b[0m  Message:    ${message}`);
  console.log(`\x1b[36m└${border}┘\x1b[0m`);
}

export function startAlertWorker(): Worker<AlertPayload> {
  const worker = new Worker<AlertPayload>('alert_queue', processAlert, {
    connection: redisConnection as any,
  });

  worker.on('failed', (job, err) => {
    console.error(`[Alert Worker] Job ${job?.id} failed:`, err.message);
  });

  return worker;
}
