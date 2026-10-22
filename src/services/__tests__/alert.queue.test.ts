import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Types } from 'mongoose';

const mockAdd = jest.fn(async () => undefined);

jest.unstable_mockModule('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({ add: mockAdd })),
}));

jest.unstable_mockModule('../../infra/redis/connection.js', () => ({
  getRedisConnection: () => ({}),
}));

describe('dispatchAlert', () => {
  const FIRST_SHIPMENT_ID = new Types.ObjectId().toString();
  const SECOND_SHIPMENT_ID = new Types.ObjectId().toString();
  let dispatchAlert: (data: {
    type: 'ANOMALY' | 'STATUS_CHANGE';
    message: string;
    shipmentId: string;
  }) => Promise<void>;

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
    const payload = { type: 'ANOMALY' as const, message: 'Temp spike', shipmentId: FIRST_SHIPMENT_ID };
    await dispatchAlert(payload);
    expect(mockAdd).toHaveBeenCalledWith('alert', payload);
  });

  it('calls queue.add for STATUS_CHANGE type', async () => {
    const payload = { type: 'STATUS_CHANGE' as const, message: 'Delivered', shipmentId: SECOND_SHIPMENT_ID };
    await dispatchAlert(payload);
    expect(mockAdd).toHaveBeenCalledWith('alert', payload);
  });
});
