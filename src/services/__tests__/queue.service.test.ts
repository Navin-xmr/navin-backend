import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockAdd = jest.fn(async (_name: string, _payload: unknown) => undefined);

jest.unstable_mockModule('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({ add: mockAdd })),
}));

jest.unstable_mockModule('../../infra/redis/connection.js', () => ({
  redisConnection: {},
}));

describe('queue.service', () => {
  let addJobToQueue: (name: string, payload: unknown) => Promise<void>;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await import('../queue.service.js');
    addJobToQueue = mod.addJobToQueue;
  });

  it('instantiates Queue with correct name', async () => {
    const { Queue } = await import('bullmq');
    expect(Queue).toHaveBeenCalledWith('transaction_queue', expect.any(Object));
  });

  it('calls queue.add with correct name and payload', async () => {
    await addJobToQueue('process_transaction', { amount: 100 });
    expect(mockAdd).toHaveBeenCalledWith('process_transaction', { amount: 100 });
  });

  it('handles empty payload', async () => {
    await addJobToQueue('empty_job', {});
    expect(mockAdd).toHaveBeenCalledWith('empty_job', {});
  });
});
