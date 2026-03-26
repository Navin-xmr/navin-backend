import { Queue } from 'bullmq';
import { redisConnection } from '../infra/redis/connection.js';

const transactionQueue = new Queue('transaction_queue', {
  connection: redisConnection as any,
});

export async function addJobToQueue(name: string, payload: unknown): Promise<void> {
  await transactionQueue.add(name, payload);
}