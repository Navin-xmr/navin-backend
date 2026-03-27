import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import request from 'supertest';

describe('POST /api/webhooks/iot/sensor', () => {
  const validPayload = {
    sensorId: 'SENSOR-001',
    timestamp: '2026-01-15T12:30:00.000Z',
    temp: 22.5,
    humidity: 55,
    location: { lat: 12.34, lng: 56.78 },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockFindShipment: any = jest.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockSaveTelemetry: any = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();

    await jest.unstable_mockModule('../src/modules/webhooks/iot.service.js', () => ({
      findShipmentBySensorId: mockFindShipment,
      saveIotTelemetry: mockSaveTelemetry,
    }));

    await jest.unstable_mockModule('../src/infra/socket/io.js', () => ({
      initSocketIO: jest.fn(),
      getIO: jest.fn(),
      emitAnomalyDetected: jest.fn(),
      emitTelemetryUpdate: jest.fn(),
      emitStatusUpdate: jest.fn(),
    }));

    await jest.unstable_mockModule('../src/infra/redis/queue.js', () => ({
      pushAlertJob: jest.fn(),
      pushStellarAnchorJob: jest.fn(),
      getTransactionQueue: jest.fn(),
      getRedisClient: jest.fn(),
    }));

    await jest.unstable_mockModule('../src/modules/telemetry/telemetry.model.js', () => ({
      Telemetry: { create: jest.fn() },
      TelemetryAnchorStatus: {
        PENDING_ANCHOR: 'PENDING_ANCHOR',
        ANCHORED: 'ANCHORED',
        ANCHOR_FAILED: 'ANCHOR_FAILED',
      },
    }));

    await jest.unstable_mockModule('../src/modules/auth/apiKey.service.js', () => ({
      validateApiKey: jest.fn(),
      generateApiKey: jest.fn(),
      revokeApiKey: jest.fn(),
      listApiKeys: jest.fn(),
    }));

    const { buildApp } = await import('../src/app.js');
    app = buildApp();
  });

  it('returns 202 and links shipmentId when sensor is associated with an active shipment', async () => {
    mockFindShipment.mockResolvedValue('SHP-123');
    mockSaveTelemetry.mockResolvedValue({ _id: 'rec1', sensorId: 'SENSOR-001', shipmentId: 'SHP-123' });

    const res = await request(app)
      .post('/api/webhooks/iot/sensor')
      .send(validPayload);

    expect(res.status).toBe(202);
    expect(res.body.shipmentId).toBe('SHP-123');
    expect(mockFindShipment).toHaveBeenCalledWith('SENSOR-001');
    expect(mockSaveTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ sensorId: 'SENSOR-001', temp: 22.5 }),
      'SHP-123',
    );
  });

  it('returns 202 with null shipmentId when no active shipment found', async () => {
    mockFindShipment.mockResolvedValue(null);
    mockSaveTelemetry.mockResolvedValue({ _id: 'rec2', sensorId: 'SENSOR-001', shipmentId: undefined });

    const res = await request(app)
      .post('/api/webhooks/iot/sensor')
      .send(validPayload);

    expect(res.status).toBe(202);
    expect(res.body.shipmentId).toBeNull();
  });

  it('returns 400 for malformed JSON (missing required fields)', async () => {
    const res = await request(app)
      .post('/api/webhooks/iot/sensor')
      .send({ sensorId: 'SENSOR-001' }); // missing temp, humidity, location, timestamp

    expect(res.status).toBe(400);
    expect(mockSaveTelemetry).not.toHaveBeenCalled();
  });

  it('returns 400 when temp is not a number', async () => {
    const res = await request(app)
      .post('/api/webhooks/iot/sensor')
      .send({ ...validPayload, temp: 'hot' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when location is missing lat/lng', async () => {
    const res = await request(app)
      .post('/api/webhooks/iot/sensor')
      .send({ ...validPayload, location: { lat: 12.34 } });

    expect(res.status).toBe(400);
  });
});
