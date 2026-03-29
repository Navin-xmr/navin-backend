import { describe, it, expect, beforeEach, jest } from '@jest/globals';

describe('processIotWebhook', () => {
  const payload = {
    shipmentId: '507f1f77bcf86cd799439011',
    temperature: 25.5,
    humidity: 60,
    latitude: 40.7128,
    longitude: -74.006,
    batteryLevel: 85,
    timestamp: new Date('2026-01-01T00:00:00.000Z'),
  };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('creates telemetry, queues anchor job, and emits telemetry update', async () => {
    const createTelemetryRecord = jest.fn(async () => ({
      _id: { toString: () => 'telemetry-1' },
      shipmentId: { toString: () => payload.shipmentId },
      temperature: payload.temperature,
      humidity: payload.humidity,
      batteryLevel: payload.batteryLevel,
      timestamp: payload.timestamp,
    }));
    const detectAnomaly = jest.fn(async () => ({ detected: false, anomalies: [] }));
    const emitTelemetryUpdate = jest.fn();
    const emitAnomalyDetected = jest.fn();
    const pushStellarAnchorJob = jest.fn(async () => undefined);
    const pushAlertJob = jest.fn(async () => undefined);

    await jest.unstable_mockModule('../src/modules/telemetry/telemetry.service.js', () => ({
      createTelemetryRecord,
    }));
    await jest.unstable_mockModule('../src/modules/anomaly/anomaly.service.js', () => ({
      detectAnomaly,
    }));
    await jest.unstable_mockModule('../src/infra/socket/io.js', () => ({
      emitTelemetryUpdate,
      emitAnomalyDetected,
      emitStatusUpdate: jest.fn(),
      getIO: jest.fn(),
      initSocketIO: jest.fn(),
    }));
    await jest.unstable_mockModule('../src/infra/redis/queue.js', () => ({
      pushStellarAnchorJob,
      pushAlertJob,
      getRedisClient: jest.fn(),
      getTransactionQueue: jest.fn(),
    }));

    const { processIotWebhook } = await import('../src/modules/webhooks/iot.service.js');

    const result = await processIotWebhook(payload as any);
    await new Promise(resolve => setImmediate(resolve));

    expect(result).toBeDefined();
    expect(createTelemetryRecord).toHaveBeenCalledTimes(1);
    expect(pushStellarAnchorJob).toHaveBeenCalledTimes(1);
    expect((pushStellarAnchorJob as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]).toEqual(
      expect.objectContaining({ telemetryId: 'telemetry-1', shipmentId: payload.shipmentId })
    );
    expect(emitTelemetryUpdate).toHaveBeenCalledTimes(1);
    expect(emitAnomalyDetected).not.toHaveBeenCalled();
    expect(pushAlertJob).not.toHaveBeenCalled();
  });

  it('emits anomaly event and queues alert when anomaly is detected', async () => {
    const createTelemetryRecord = jest.fn(async () => ({
      _id: { toString: () => 'telemetry-2' },
      shipmentId: { toString: () => payload.shipmentId },
      temperature: payload.temperature,
      humidity: payload.humidity,
      batteryLevel: payload.batteryLevel,
      timestamp: payload.timestamp,
    }));
    const detectAnomaly = jest.fn(async () => ({
      detected: true,
      anomalies: [
        {
          shipmentId: payload.shipmentId,
          type: 'TEMPERATURE_ANOMALY',
          severity: 'HIGH',
          message: 'High temperature',
        },
      ],
    }));
    const emitTelemetryUpdate = jest.fn();
    const emitAnomalyDetected = jest.fn();
    const pushStellarAnchorJob = jest.fn(async () => undefined);
    const pushAlertJob = jest.fn(async () => undefined);

    await jest.unstable_mockModule('../src/modules/telemetry/telemetry.service.js', () => ({
      createTelemetryRecord,
    }));
    await jest.unstable_mockModule('../src/modules/anomaly/anomaly.service.js', () => ({
      detectAnomaly,
    }));
    await jest.unstable_mockModule('../src/infra/socket/io.js', () => ({
      emitTelemetryUpdate,
      emitAnomalyDetected,
      emitStatusUpdate: jest.fn(),
      getIO: jest.fn(),
      initSocketIO: jest.fn(),
    }));
    await jest.unstable_mockModule('../src/infra/redis/queue.js', () => ({
      pushStellarAnchorJob,
      pushAlertJob,
      getRedisClient: jest.fn(),
      getTransactionQueue: jest.fn(),
    }));

    const { processIotWebhook } = await import('../src/modules/webhooks/iot.service.js');

    await processIotWebhook(payload as any);
    await new Promise(resolve => setImmediate(resolve));

    expect(emitAnomalyDetected).toHaveBeenCalledTimes(1);
    expect(pushAlertJob).toHaveBeenCalledTimes(1);
  });

  it('propagates telemetry creation failures', async () => {
    const createTelemetryRecord = jest.fn(async () => {
      throw new Error('Database down');
    });

    await jest.unstable_mockModule('../src/modules/telemetry/telemetry.service.js', () => ({
      createTelemetryRecord,
    }));
    await jest.unstable_mockModule('../src/modules/anomaly/anomaly.service.js', () => ({
      detectAnomaly: jest.fn(),
    }));
    await jest.unstable_mockModule('../src/infra/socket/io.js', () => ({
      emitTelemetryUpdate: jest.fn(),
      emitAnomalyDetected: jest.fn(),
      emitStatusUpdate: jest.fn(),
      getIO: jest.fn(),
      initSocketIO: jest.fn(),
    }));
    await jest.unstable_mockModule('../src/infra/redis/queue.js', () => ({
      pushStellarAnchorJob: jest.fn(),
      pushAlertJob: jest.fn(),
      getRedisClient: jest.fn(),
      getTransactionQueue: jest.fn(),
    }));

    const { processIotWebhook } = await import('../src/modules/webhooks/iot.service.js');

    await expect(processIotWebhook(payload as any)).rejects.toThrow('Database down');
  });
});
