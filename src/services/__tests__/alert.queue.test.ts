import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockAdd: any = jest.fn(async () => undefined);

jest.unstable_mockModule('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({ add: mockAdd })),
}));

jest.unstable_mockModule('../../infra/redis/connection.js', () => ({
  redisConnection: {},
}));

describe('dispatchAlert', () => {
  let dispatchAlert: (data: { type: 'ANOMALY' | 'STATUS_CHANGE'; message: string; shipmentId: string }) => Promise<void>;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await import('../queue.service.js');
    dispatchAlert = mod.dispatchAlert;
  });

  it('instantiates alert_queue with correct name', async () => {
    const { Queue } = await import('bullmq');
    expect(Queue).toHaveBeenCalledWith('alert_queue', expect.any(Object));
  });

  it('calls queue.add with alert payload', async () => {
    const payload = { type: 'ANOMALY' as const, message: 'Temp spike', shipmentId: 'ship-1' };
    await dispatchAlert(payload);
    expect(mockAdd).toHaveBeenCalledWith('alert', payload);
  });

  it('calls queue.add for STATUS_CHANGE type', async () => {
    const payload = { type: 'STATUS_CHANGE' as const, message: 'Delivered', shipmentId: 'ship-2' };
    await dispatchAlert(payload);
    expect(mockAdd).toHaveBeenCalledWith('alert', payload);
  });
});
