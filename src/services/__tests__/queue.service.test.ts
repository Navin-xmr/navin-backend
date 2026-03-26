import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// Jest's inference for `.mockResolvedValue()` can be too strict in ESM+TS builds here.
// We only care that `add` is called with the right args.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockAdd: any = jest.fn(async () => undefined);

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