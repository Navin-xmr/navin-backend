import { describe, expect, beforeEach, it, jest } from '@jest/globals';
import request from 'supertest';
import { generateDataHash } from '../src/shared/utils/crypto.js';
import type { Application } from 'express';

type TelemetryCreateResult = {
  _id: string;
  shipmentId: string;
  temperature: number;
  humidity: number;
  latitude: number;
  longitude: number;
  batteryLevel: number;
  timestamp: Date;
  dataHash: string;
  anchorStatus: string;
  rawPayload: {
    shipmentId: string;
    temperature: number;
    humidity: number;
    latitude: number;
    longitude: number;
    batteryLevel: number;
    timestamp: Date;
  };
};

type ValidateApiKeyResult = {
  isValid: boolean;
  apiKeyDoc?: {
    _id: string;
    organizationId: string;
    shipmentId: string;
  };
};

describe('POST /api/webhooks/iot', () => {
  const body = {
    sensorId: 'sensor-abc-001',
    timestamp: '2026-01-15T12:30:00.000Z',
    temp: 22.5,
    humidity: 55,
    location: { lat: 12.34, lng: 56.78 },
  };

  const parsedBodyForHash = {
    ...body,
    timestamp: new Date(body.timestamp),
  };

  const dataHash = generateDataHash(parsedBodyForHash);

  let app: Application;
  const mockTelemetryCreate = jest.fn<(payload: unknown) => Promise<TelemetryCreateResult>>();
  const mockValidateApiKey = jest.fn<(rawApiKey: string) => Promise<ValidateApiKeyResult>>();
  const mockPushStellarAnchorJob = jest.fn<
    (payload: { telemetryId: string; shipmentId: string; dataHash: string }) => Promise<void>
  >();

  beforeEach(async () => {
    jest.clearAllMocks();

    mockTelemetryCreate.mockResolvedValue({
      _id: 't1',
      sensorId: body.sensorId,
      shipmentId: resolvedShipmentId,
      temperature: body.temp,
      humidity: body.humidity,
      latitude: body.location.lat,
      longitude: body.location.lng,
      timestamp: parsedBodyForHash.timestamp,
      dataHash,
      anchorStatus: 'PENDING_ANCHOR',
      rawPayload: parsedBodyForHash,
    });

    mockValidateApiKey.mockResolvedValue({
      isValid: true,
      apiKeyDoc: { _id: 'key123', organizationId: 'org456' },
    });

    mockPushStellarAnchorJob.mockResolvedValue(undefined);

    mockFindActiveShipmentBySensorId.mockResolvedValue({
      _id: resolvedShipmentId,
      status: 'IN_TRANSIT',
    });

    await jest.unstable_mockModule('../src/modules/telemetry/telemetry.model.js', () => ({
      Telemetry: { create: mockTelemetryCreate },
      TelemetryAnchorStatus: {
        PENDING_ANCHOR: 'PENDING_ANCHOR',
        ANCHORED: 'ANCHORED',
        ANCHOR_FAILED: 'ANCHOR_FAILED',
      },
    }));

    await jest.unstable_mockModule('../src/modules/telemetry/telemetry.service.js', () => ({
      createTelemetryRecord: async (input: any) => mockTelemetryCreate(input),
      findActiveShipmentBySensorId: mockFindActiveShipmentBySensorId,
      updateTelemetryAnchor: jest.fn(),
      markTelemetryAnchorFailed: jest.fn(),
      getTelemetryService: jest.fn(),
    }));

    await jest.unstable_mockModule('../src/modules/auth/apiKey.service.js', () => ({
      validateApiKey: mockValidateApiKey,
      generateApiKey: jest.fn(),
      revokeApiKey: jest.fn(),
      listApiKeys: jest.fn(),
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
      pushStellarAnchorJob: mockPushStellarAnchorJob,
      getTransactionQueue: jest.fn(),
      getRedisClient: jest.fn(),
    }));

    const appModule = await import('../src/app.js');
    app = appModule.buildApp();
  });

  it('returns 202 and queues Stellar anchoring job', async () => {
    const res = await request(app)
      .post('/api/webhooks/iot')
      .set('x-api-key', 'valid-api-key-12345')
      .send(body);

    expect(res.status).toBe(202);
    expect(res.body.message).toContain('queued for Stellar anchoring');

    expect(mockFindActiveShipmentBySensorId).toHaveBeenCalledWith(body.sensorId);

    expect(mockPushStellarAnchorJob).toHaveBeenCalledWith(
      expect.objectContaining({ shipmentId: resolvedShipmentId }),
    );

    expect(res.body.data).toEqual(
      expect.objectContaining({ anchorStatus: 'PENDING_ANCHOR' }),
    );
  });

  it('saves telemetry with PENDING_ANCHOR status', async () => {
    const res = await request(app)
      .post('/api/webhooks/iot')
      .set('x-api-key', 'valid-api-key-12345')
      .send(body);

    expect(res.status).toBe(202);
    expect(res.body.data.anchorStatus).toBe('PENDING_ANCHOR');
    expect(res.body.data.stellarTxHash).toBeUndefined();
  });

  it('returns 404 when no active shipment is found for sensorId', async () => {
    mockFindActiveShipmentBySensorId.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/webhooks/iot')
      .set('x-api-key', 'valid-api-key-12345')
      .send(body);

    expect(res.status).toBe(404);
    expect(res.body.message).toContain('sensor-abc-001');
  });

  it('returns 401 when x-api-key header is missing', async () => {
    const res = await request(app)
      .post('/api/webhooks/iot')
      .send(body);

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Missing x-api-key header');
    expect(mockValidateApiKey).not.toHaveBeenCalled();
  });

  it('returns 401 when API key is invalid', async () => {
    mockValidateApiKey.mockResolvedValue({ isValid: false });

    const res = await request(app)
      .post('/api/webhooks/iot')
      .set('x-api-key', 'invalid-api-key')
      .send(body);

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid API key');
  });

  it('returns 400 on malformed payload (temp is not a number)', async () => {
    const res = await request(app)
      .post('/api/webhooks/iot')
      .set('x-api-key', 'valid-api-key-12345')
      .send({ ...body, temp: 'not-a-number' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when required field is missing', async () => {
    const { sensorId: _omit, ...noSensorId } = body;

    const res = await request(app)
      .post('/api/webhooks/iot')
      .set('x-api-key', 'valid-api-key-12345')
      .send(noSensorId);

    expect(res.status).toBe(400);
  });

  it('returns 400 when location is malformed', async () => {
    const res = await request(app)
      .post('/api/webhooks/iot')
      .set('x-api-key', 'valid-api-key-12345')
      .send({ ...body, location: 'not-an-object' });

    expect(res.status).toBe(400);
  });
});
