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
    shipmentId: '671000000000000000000001',
    temperature: 22.5,
    humidity: 55,
    latitude: 12.34,
    longitude: 56.78,
    batteryLevel: 91,
    timestamp: '2026-01-15T12:30:00.000Z',
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
      shipmentId: body.shipmentId,
      temperature: body.temperature,
      humidity: body.humidity,
      latitude: body.latitude,
      longitude: body.longitude,
      batteryLevel: body.batteryLevel,
      timestamp: parsedBodyForHash.timestamp,
      dataHash,
      anchorStatus: 'PENDING_ANCHOR',
      rawPayload: parsedBodyForHash,
    });

    mockValidateApiKey.mockResolvedValue({
      isValid: true,
      apiKeyDoc: {
        _id: 'key123',
        organizationId: 'org456',
        shipmentId: body.shipmentId,
      },
    });

    mockPushStellarAnchorJob.mockResolvedValue(undefined);

    await jest.unstable_mockModule('../src/modules/telemetry/telemetry.model.js', () => ({
      Telemetry: {
        create: mockTelemetryCreate,
      },
      TelemetryAnchorStatus: {
        PENDING_ANCHOR: 'PENDING_ANCHOR',
        ANCHORED: 'ANCHORED',
        ANCHOR_FAILED: 'ANCHOR_FAILED',
      },
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

  it('returns 202 Accepted and queues Stellar anchoring job', async () => {
    const res = await request(app)
      .post('/api/webhooks/iot')
      .set('x-api-key', 'valid-api-key-12345')
      .send(body);

    expect(res.status).toBe(202);
    expect(res.body.message).toContain('queued for Stellar anchoring');
    
    expect(mockPushStellarAnchorJob).toHaveBeenCalledTimes(1);
    expect(mockPushStellarAnchorJob).toHaveBeenCalledWith({
      telemetryId: 't1',
      shipmentId: body.shipmentId,
      dataHash,
    });

    expect(mockTelemetryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        shipmentId: body.shipmentId,
        temperature: body.temperature,
        humidity: body.humidity,
        dataHash,
        anchorStatus: 'PENDING_ANCHOR',
      })
    );

    expect(res.body.data).toEqual(
      expect.objectContaining({
        dataHash,
        anchorStatus: 'PENDING_ANCHOR',
      })
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

  it('returns 401 when x-api-key header is missing', async () => {
    const res = await request(app)
      .post('/api/webhooks/iot')
      .send(body);

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Missing x-api-key header');
    expect(mockValidateApiKey).not.toHaveBeenCalled();
  });

  it('returns 401 when API key is invalid', async () => {
    mockValidateApiKey.mockResolvedValue({
      isValid: false,
    });

    const res = await request(app)
      .post('/api/webhooks/iot')
      .set('x-api-key', 'invalid-api-key')
      .send(body);

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid API key');
    expect(mockValidateApiKey).toHaveBeenCalledWith('invalid-api-key');
  });

  it('returns 400 on invalid payload (validation error)', async () => {
    const res = await request(app)
      .post('/api/webhooks/iot')
      .set('x-api-key', 'valid-api-key-12345')
      .send({
        ...body,
        temperature: 'not-a-number',
      });

    expect(res.status).toBe(400);
  });

  it('returns 400 on malformed JSON body', async () => {
    const res = await request(app)
      .post('/api/webhooks/iot')
      .set('x-api-key', 'valid-api-key-12345')
      .set('Content-Type', 'application/json')
      .send('{"shipmentId":');

    expect(res.status).toBe(400);
  });
});

