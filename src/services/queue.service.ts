import { Queue } from 'bullmq';
import { getRedisConnection } from '../infra/redis/connection.js';

const transactionQueue = new Queue('transaction_queue', {
  connection: getRedisConnection() as unknown as Record<string, unknown>,
});

const alertQueue = new Queue('alert_queue', {
  connection: getRedisConnection() as unknown as Record<string, unknown>,
});

export type AlertPayload = {
  type: 'ANOMALY' | 'STATUS_CHANGE';
  message: string;
  shipmentId: string;
};

/**
 * Enqueues a job on the transaction queue.
 * @param {string} name - Name of the queue job.
 * @param {unknown} payload - Job payload.
 * @returns {Promise<void>} Resolves when the job is queued.
 */
export async function addJobToQueue(name: string, payload: unknown): Promise<void> {
  await transactionQueue.add(name, payload);
}

/**
 * Dispatches an alert job for anomalies or status changes.
 * @param {AlertPayload} data - Alert payload details.
 * @returns {Promise<void>} Resolves when the alert job is queued.
 */
export async function dispatchAlert(data: AlertPayload): Promise<void> {
  await alertQueue.add('alert', data);
}
