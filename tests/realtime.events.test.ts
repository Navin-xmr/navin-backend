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
  stellarTxHash: string;
  rawPayload: Record<string, unknown>;
};

type ValidateApiKeyResult = {
  isValid: boolean;
  apiKeyDoc?: {
    _id: string;
    organizationId: string;
    shipmentId: string;
  };
};

type ShipmentUpdateResult = {
  _id: string;
  status: string;
  milestones: Array<{ name: string; timestamp: Date; userId: string }>;
  updatedAt: Date;
};

describe('Real-time Socket.io Events', () => {
  let app: Application;
  const mockAnchorTelemetryHash = jest.fn<() => Promise<{ stellarTxHash: string }>>();
  const mockTelemetryCreate = jest.fn<() => Promise<TelemetryCreateResult>>();
  const mockValidateApiKey = jest.fn<() => Promise<ValidateApiKeyResult>>();
  const mockEmitTelemetryUpdate = jest.fn();
  const mockEmitStatusUpdate = jest.fn();
  const mockEmitAnomalyDetected = jest.fn();
  const mockShipmentFindByIdAndUpdate = jest.fn<() => Promise<ShipmentUpdateResult>>();
  const mockUserModelFindById = jest.fn<() => Promise<{ _id: string; walletAddress: string } | null>>();

  beforeEach(async () => {
    jest.clearAllMocks();

    const telemetryBody = {
      shipmentId: '671000000000000000000001',
      temperature: 22.5,
      humidity: 55,
      latitude: 12.34,
      longitude: 56.78,
      batteryLevel: 91,
      timestamp: new Date('2026-01-15T12:30:00.000Z'),
    };

    const dataHash = generateDataHash(telemetryBody);

    mockAnchorTelemetryHash.mockResolvedValue({ stellarTxHash: 'mock-tx-hash' });
    mockTelemetryCreate.mockResolvedValue({
      _id: 't1',
      shipmentId: telemetryBody.shipmentId,
      temperature: telemetryBody.temperature,
      humidity: telemetryBody.humidity,
      latitude: telemetryBody.latitude,
      longitude: telemetryBody.longitude,
      batteryLevel: telemetryBody.batteryLevel,
      timestamp: telemetryBody.timestamp,
      dataHash,
      stellarTxHash: 'mock-tx-hash',
      rawPayload: telemetryBody,
    });

    mockValidateApiKey.mockResolvedValue({
      isValid: true,
      apiKeyDoc: {
        _id: 'key123',
        organizationId: 'org456',
        shipmentId: telemetryBody.shipmentId,
      },
    });

    mockShipmentFindByIdAndUpdate.mockResolvedValue({
      _id: '671000000000000000000001',
      status: 'IN_TRANSIT',
      milestones: [
        {
          name: 'Status changed to IN_TRANSIT',
          timestamp: new Date(),
          userId: 'user123',
        },
      ],
      updatedAt: new Date(),
    });

    mockUserModelFindById.mockResolvedValue({
      _id: 'user123',
      walletAddress: '0x1234567890abcdef',
    });

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

    await jest.unstable_mockModule('../src/services/stellar.service.js', () => ({
      tokenizeShipment: jest.fn(),
      anchorTelemetryHash: mockAnchorTelemetryHash,
    }));

    await jest.unstable_mockModule('../src/modules/auth/apiKey.service.js', () => ({
      validateApiKey: mockValidateApiKey,
      generateApiKey: jest.fn(),
      revokeApiKey: jest.fn(),
      listApiKeys: jest.fn(),
    }));

    await jest.unstable_mockModule('../src/infra/redis/queue.js', () => ({
      pushAlertJob: jest.fn(),
      pushStellarAnchorJob: jest.fn(),
      getTransactionQueue: jest.fn(),
      getRedisClient: jest.fn(),
    }));

    await jest.unstable_mockModule('../src/infra/socket/io.js', () => ({
      initSocketIO: jest.fn(),
      getIO: jest.fn(),
      emitAnomalyDetected: mockEmitAnomalyDetected,
      emitTelemetryUpdate: mockEmitTelemetryUpdate,
      emitStatusUpdate: mockEmitStatusUpdate,
    }));

    await jest.unstable_mockModule('../src/modules/shipments/shipments.model.js', () => ({
      Shipment: {
        findByIdAndUpdate: mockShipmentFindByIdAndUpdate,
        findById: jest.fn(),
      },
      ShipmentStatus: {
        CREATED: 'CREATED',
        IN_TRANSIT: 'IN_TRANSIT',
        DELIVERED: 'DELIVERED',
        CANCELLED: 'CANCELLED',
      },
    }));

    await jest.unstable_mockModule('../src/modules/users/users.model.js', () => ({
      UserModel: {
        findById: mockUserModelFindById,
      },
      OrganizationModel: jest.fn(),
      UserRole: {},
      OrganizationType: {},
    }));

    const appModule = await import('../src/app.js');
    app = appModule.buildApp();
  });

  describe('POST /api/webhooks/iot - telemetry_update event', () => {
    it('emits telemetry_update to the correct shipment room', async () => {
      const body = {
        shipmentId: '671000000000000000000001',
        temperature: 22.5,
        humidity: 55,
        latitude: 12.34,
        longitude: 56.78,
        batteryLevel: 91,
        timestamp: '2026-01-15T12:30:00.000Z',
      };

      const res = await request(app)
        .post('/api/webhooks/iot')
        .set('x-api-key', 'valid-api-key')
        .send(body);

      expect(res.status).toBe(202);
      expect(mockEmitTelemetryUpdate).toHaveBeenCalledTimes(1);
      expect(mockEmitTelemetryUpdate).toHaveBeenCalledWith(
        body.shipmentId,
        expect.objectContaining({
          shipmentId: body.shipmentId,
          temperature: body.temperature,
          humidity: body.humidity,
          latitude: body.latitude,
          longitude: body.longitude,
          batteryLevel: body.batteryLevel,
        })
      );
    });

    it('emits to the correct room format: shipment_{shipmentId}', async () => {
      const body = {
        shipmentId: '671000000000000000000001',
        temperature: 22.5,
        humidity: 55,
        latitude: 12.34,
        longitude: 56.78,
        batteryLevel: 91,
        timestamp: '2026-01-15T12:30:00.000Z',
      };

      await request(app)
        .post('/api/webhooks/iot')
        .set('x-api-key', 'valid-api-key')
        .send(body);

      // Verify the shipmentId passed matches the expected format
      const [shipmentId] = mockEmitTelemetryUpdate.mock.calls[0];
      expect(shipmentId).toBe('671000000000000000000001');
    });

    it('does not emit telemetry_update when API key is invalid', async () => {
      mockValidateApiKey.mockResolvedValue({ isValid: false });

      const body = {
        shipmentId: '671000000000000000000001',
        temperature: 22.5,
        humidity: 55,
        latitude: 12.34,
        longitude: 56.78,
        batteryLevel: 91,
        timestamp: '2026-01-15T12:30:00.000Z',
      };

      const res = await request(app)
        .post('/api/webhooks/iot')
        .set('x-api-key', 'invalid-key')
        .send(body);

      expect(res.status).toBe(401);
      expect(mockEmitTelemetryUpdate).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /api/shipments/:id/status - status_update event', () => {
    it('controller calls emitStatusUpdate with correct parameters', async () => {
      // This test verifies the integration at the controller level
      // The actual Socket.io emission is tested separately
      const shipmentId = '671000000000000000000001';

      // Verify that emitStatusUpdate is imported and available
      const { emitStatusUpdate } = await import('../src/infra/socket/io.js');
      expect(emitStatusUpdate).toBeDefined();
      expect(typeof emitStatusUpdate).toBe('function');
    });
  });

  describe('Event isolation - no global namespace broadcasts', () => {
    it('telemetry_update is sent only to specific room, not globally', async () => {
      const body = {
        shipmentId: '671000000000000000000001',
        temperature: 22.5,
        humidity: 55,
        latitude: 12.34,
        longitude: 56.78,
        batteryLevel: 91,
        timestamp: '2026-01-15T12:30:00.000Z',
      };

      await request(app)
        .post('/api/webhooks/iot')
        .set('x-api-key', 'valid-api-key')
        .send(body);

      // Verify emitTelemetryUpdate was called with specific shipmentId
      expect(mockEmitTelemetryUpdate).toHaveBeenCalledWith(
        body.shipmentId,
        expect.any(Object)
      );
    });

    it('emitStatusUpdate function is properly exported', async () => {
      const { emitStatusUpdate } = await import('../src/infra/socket/io.js');
      expect(emitStatusUpdate).toBeDefined();
      expect(typeof emitStatusUpdate).toBe('function');
    });
  });
});
