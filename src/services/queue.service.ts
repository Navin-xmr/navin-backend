import { Queue } from 'bullmq';
import { redisConnection } from '../infra/redis/connection.js';

const transactionQueue = new Queue('transaction_queue', {
  connection: redisConnection as unknown as Record<string, unknown>,
});

const alertQueue = new Queue('alert_queue', {
  connection: redisConnection as unknown as Record<string, unknown>,
});

export type AlertPayload = {
  type: 'ANOMALY' | 'STATUS_CHANGE';
  message: string;
  shipmentId: string;
};

export async function addJobToQueue(name: string, payload: unknown): Promise<void> {
  await transactionQueue.add(name, payload);
}

export async function dispatchAlert(payload: AlertPayload): Promise<void> {
  await alertQueue.add('alert', payload);
}
