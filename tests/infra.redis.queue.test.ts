import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockLpush = jest.fn<(...args: unknown[]) => Promise<number>>();
const mockAdd = jest.fn<(...args: unknown[]) => Promise<unknown>>();

const RedisMock = jest.fn().mockImplementation(() => ({
  lpush: mockLpush,
}));

const QueueMock = jest.fn().mockImplementation(() => ({
  add: mockAdd,
}));

describe('infra/redis/queue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    mockLpush.mockResolvedValue(1);
    mockAdd.mockResolvedValue({ id: 'job-1' });
  });

  it('reuses singleton redis client and transaction queue', async () => {
    await jest.unstable_mockModule('../src/config/index.js', () => ({
      config: { redisUrl: 'redis://localhost:6379' },
    }));
    await jest.unstable_mockModule('ioredis', () => ({ Redis: RedisMock }));
    await jest.unstable_mockModule('bullmq', () => ({ Queue: QueueMock }));

    const queueMod = await import('../src/infra/redis/queue.js');

    const client1 = queueMod.getRedisClient();
    const client2 = queueMod.getRedisClient();
    const queue1 = queueMod.getTransactionQueue();
    const queue2 = queueMod.getTransactionQueue();

    expect(client1).toBe(client2);
    expect(queue1).toBe(queue2);
    expect(RedisMock).toHaveBeenCalledTimes(1);
    expect(QueueMock).toHaveBeenCalledTimes(1);
  });

  it('pushes alert jobs to alert_queue', async () => {
    await jest.unstable_mockModule('../src/config/index.js', () => ({
      config: { redisUrl: 'redis://localhost:6379' },
    }));
    await jest.unstable_mockModule('ioredis', () => ({ Redis: RedisMock }));
    await jest.unstable_mockModule('bullmq', () => ({ Queue: QueueMock }));

    const queueMod = await import('../src/infra/redis/queue.js');

    await queueMod.pushAlertJob({
      shipmentId: 's1',
      type: 'TEMP',
      severity: 'HIGH',
      message: 'Too hot',
    });

    expect(mockLpush).toHaveBeenCalledWith(
      'alert_queue',
      JSON.stringify({ shipmentId: 's1', type: 'TEMP', severity: 'HIGH', message: 'Too hot' })
    );
  });

  it('pushes stellar anchor jobs with retry/backoff options', async () => {
    await jest.unstable_mockModule('../src/config/index.js', () => ({
      config: { redisUrl: 'redis://localhost:6380' },
    }));
    await jest.unstable_mockModule('ioredis', () => ({ Redis: RedisMock }));
    await jest.unstable_mockModule('bullmq', () => ({ Queue: QueueMock }));

    const queueMod = await import('../src/infra/redis/queue.js');

    await queueMod.pushStellarAnchorJob({
      telemetryId: 't1',
      shipmentId: 's1',
      dataHash: 'abc123',
    });

    expect(mockAdd).toHaveBeenCalledWith(
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
