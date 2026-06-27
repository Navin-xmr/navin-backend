import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import request from 'supertest';
import type { Application } from 'express';

describe('POST /api/webhooks/iot', () => {
  const body = {
    shipmentId: '507f1f77bcf86cd799439011',
    timestamp: '2026-01-15T12:30:00.000Z',
    temperature: 22.5,
    humidity: 55,
    latitude: 12.34,
    longitude: 56.78,
    batteryLevel: 88,
  };

  let app: Application;
  const mockValidateApiKey = jest.fn<any>();
  const mockPushStellarAnchorJob = jest.fn<any>();

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.resetModules();

    mockValidateApiKey.mockResolvedValue({
      isValid: true,
      apiKeyDoc: { _id: 'key123', organizationId: 'org456', shipmentId: body.shipmentId },
    });
    mockPushStellarAnchorJob.mockResolvedValue(undefined);

    await jest.unstable_mockModule('../src/modules/telemetry/telemetry.model.js', () => ({
      Telemetry: {
        create: jest.fn(),
        find: jest.fn(),
        findById: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      TelemetryAnchorStatus: {
        PENDING_ANCHOR: 'PENDING_ANCHOR',
        ANCHORED: 'ANCHORED',
        ANCHOR_FAILED: 'ANCHOR_FAILED',
      },
    }));

    await jest.unstable_mockModule('../src/modules/telemetry/telemetry.service.js', () => ({
      findActiveShipmentBySensorId: jest.fn(),
      createTelemetryRecord: jest.fn(async (input: any) => ({
        _id: 't1',
        shipmentId: input.shipmentId,
        sensorId: input.sensorId ?? input.shipmentId,
        temperature: input.temperature,
        humidity: input.humidity,
        latitude: input.latitude,
        longitude: input.longitude,
        batteryLevel: input.batteryLevel,
        timestamp: input.timestamp,
        dataHash: input.dataHash,
        anchorStatus: 'PENDING_ANCHOR',
      })),
      updateTelemetryAnchor: jest.fn(),
      markTelemetryAnchorFailed: jest.fn(),
      getTelemetryService: jest.fn(),
      bulkIngestTelemetry: jest.fn().mockResolvedValue([]),
      getTelemetryThresholds: jest
        .fn()
        .mockReturnValue({ minBatteryLevel: 20, maxTemperature: 25, maxHumidity: 80 }),
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

    await jest.unstable_mockModule('../src/services/stellar.service.js', () => ({
      tokenizeShipment: jest.fn(),
      anchorTelemetryHash: jest.fn(),
      releaseEscrow: jest.fn(),
      getStellarExplorerUrl: jest.fn(() => 'https://stellar.expert/explorer/testnet/tx/mock'),
    }));

    await jest.unstable_mockModule('../src/modules/users/users.model.js', () => ({
      UserModel: { findById: jest.fn(), findOne: jest.fn(), create: jest.fn() },
      OrganizationModel: { findById: jest.fn() },
      UserRole: {
        SUPER_ADMIN: 'SUPER_ADMIN',
        ADMIN: 'ADMIN',
        MANAGER: 'MANAGER',
        VIEWER: 'VIEWER',
        CUSTOMER: 'CUSTOMER',
      },
      OrganizationType: {
        ENTERPRISE: 'ENTERPRISE',
        LOGISTICS: 'LOGISTICS',
      },
    }));

    const appModule = await import('../src/app.js');
    app = appModule.buildApp();
  });

  it('returns 202 and queues Stellar anchoring job', async () => {
    const res = await request(app)
      .post('/api/webhooks/iot')
      .set('x-api-key', 'valid-api-key')
      .send(body);

    expect(res.status).toBe(202);
    expect(mockPushStellarAnchorJob).toHaveBeenCalled();
    expect(res.body.data.anchorStatus).toBe('PENDING_ANCHOR');
  });

  it('returns 401 when x-api-key header is missing', async () => {
    const res = await request(app).post('/api/webhooks/iot').send(body);
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid payload', async () => {
    const res = await request(app)
      .post('/api/webhooks/iot')
      .set('x-api-key', 'valid-api-key')
      .send({ ...body, temperature: 'not-a-number' });
    expect(res.status).toBe(400);
  });
});
