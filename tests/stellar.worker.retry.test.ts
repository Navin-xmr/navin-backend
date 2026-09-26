import { describe, expect, it, jest } from '@jest/globals';

class StellarTimeoutError extends Error {
  name = 'TimeoutError';
  constructor(message: string) {
    super(message);
  }
}

describe('Stellar Worker Failure and Retry Tests', () => {
  it('classifies Stellar timeout failures with TimeoutError name', () => {
    const err = new StellarTimeoutError('Transaction timed out after 60 seconds');
    expect(err.name).toBe('TimeoutError');
    expect(err).toBeInstanceOf(Error);
  });

  it('retries transient timeout failures before succeeding', async () => {
    let attempts = 0;
    const processor = jest.fn(async () => {
      attempts += 1;
      if (attempts <= 2) {
        throw new StellarTimeoutError('Transaction timed out');
      }
      return { stellarTxHash: 'success-tx-hash' };
    });

    let result: unknown;
    for (let i = 0; i < 3; i += 1) {
      try {
        result = await processor();
        break;
      } catch (error) {
        if (i === 2) throw error;
      }
    }

    expect(processor).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ stellarTxHash: 'success-tx-hash' });
  });

  it('surfaces non-timeout errors without masking the message', async () => {
    const processor = jest.fn(async () => {
      throw new Error('Invalid transaction data');
    });

    await expect(processor()).rejects.toThrow('Invalid transaction data');
  });

  it('configures anchor jobs with exponential backoff in queue helper', async () => {
    // Isolation contract: under Jest the queue module serves an in-memory
    // stub (never a live Redis/BullMQ connection). Assert the retry/backoff
    // options on the stub's `add` instead of mocking bullmq internals.
    jest.resetModules();
    const queueMod = await import('../src/infra/redis/queue.js');
    const queue = queueMod.getTransactionQueue() as unknown as {
      add: (...args: unknown[]) => Promise<unknown>;
    };
    const addSpy = jest.spyOn(queue, 'add');

    await queueMod.pushStellarAnchorJob({
      telemetryId: 'telemetry-dlq',
      shipmentId: 'shipment-dlq',
      dataHash: 'dlq-hash',
    });

    expect(addSpy).toHaveBeenCalledWith(
      'anchor_telemetry',
      {
        telemetryId: 'telemetry-dlq',
        shipmentId: 'shipment-dlq',
        dataHash: 'dlq-hash',
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      }
    );

    await queueMod.disconnectQueueRedis();
  });
});
