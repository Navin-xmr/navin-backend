import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

/**
 * Redis isolation contract for `src/infra/redis/queue.js`:
 * in `NODE_ENV=test` the module must never open a real socket or construct a
 * real BullMQ Queue — it serves an in-memory stub instead.
 *
 * `getRedisClient` was deliberately removed from this module (now the private
 * `getQueueRedisClient`, delegating to the shared `connection.js` client), so
 * assertions that need raw access go through `connection.js` — the same
 * in-memory instance the queue module uses in tests.
 */
describe('infra/redis/queue', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(async () => {
    try {
      const queueMod = await import('../src/infra/redis/queue.js');
      await queueMod.disconnectQueueRedis();
    } catch {
      // Ignore teardown errors.
    }
    try {
      const { disconnectRedis } = await import('../src/infra/redis/connection.js');
      await disconnectRedis();
    } catch {
      // Ignore teardown errors.
    }
  });

  it('reuses singleton transaction queue without a live Redis', async () => {
    const queueMod = await import('../src/infra/redis/queue.js');

    const queue1 = queueMod.getTransactionQueue();
    const queue2 = queueMod.getTransactionQueue();

    expect(queue1).toBe(queue2);
  });

  it('pushes alert jobs to alert_queue', async () => {
    const queueMod = await import('../src/infra/redis/queue.js');

    await queueMod.pushAlertJob({
      shipmentId: 's1',
      type: 'TEMP',
      severity: 'HIGH',
      message: 'Too hot',
    });

    // Read back through the shared connection client — the same in-memory
    // instance pushAlertJob writes to in NODE_ENV=test.
    const { getRedisClient } = await import('../src/infra/redis/connection.js');
    const client = getRedisClient() as unknown as {
      lrange: (key: string, start: number, stop: number) => Promise<string[]>;
    };
    const items = await client.lrange('alert_queue', 0, -1);
    expect(items).toContain(
      JSON.stringify({ shipmentId: 's1', type: 'TEMP', severity: 'HIGH', message: 'Too hot' })
    );
  });

  it('pushes stellar anchor jobs with retry/backoff options', async () => {
    const queueMod = await import('../src/infra/redis/queue.js');
    const queue = queueMod.getTransactionQueue() as unknown as {
      add: (...args: unknown[]) => Promise<unknown>;
    };
    const addSpy = jest.spyOn(queue, 'add');

    await queueMod.pushStellarAnchorJob({
      telemetryId: 't1',
      shipmentId: 's1',
      dataHash: 'abc123',
    });

    expect(addSpy).toHaveBeenCalledWith(
      'anchor_telemetry',
      { telemetryId: 't1', shipmentId: 's1', dataHash: 'abc123' },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      }
    );
  });
});
