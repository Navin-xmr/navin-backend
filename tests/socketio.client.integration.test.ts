import { describe, expect, beforeAll, afterAll, it, jest } from '@jest/globals';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { createServer, Server } from 'http';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
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

describe('Socket.io Client Integration Tests', () => {
  let app: Application;
  let httpServer: Server;
  let socketClient: Socket;
  const TEST_PORT = 3999;
  const TEST_SHIPMENT_ID = '671000000000000000000001';

  const mockAnchorTelemetryHash = jest.fn<() => Promise<{ stellarTxHash: string }>>();
  const mockTelemetryCreate = jest.fn<() => Promise<TelemetryCreateResult>>();
  const mockValidateApiKey = jest.fn<() => Promise<ValidateApiKeyResult>>();

  beforeAll(async () => {
    jest.clearAllMocks();

    const telemetryBody = {
      sensorId: 'sensor-abc-001',
      shipmentId: TEST_SHIPMENT_ID,
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
        shipmentId: TEST_SHIPMENT_ID,
      },
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
      releaseEscrow: jest.fn(),
      getStellarExplorerUrl: jest.fn(() => 'https://stellar.expert/explorer/testnet/tx/mock'),
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

    await jest.unstable_mockModule('../src/modules/anomaly/anomaly.service.js', () => ({
      detectAnomaly: jest.fn<any>().mockResolvedValue({ detected: false, anomalies: [] }),
    }));

    await jest.unstable_mockModule('../src/modules/shipments/shipments.model.js', () => ({
      Shipment: {
        findById: jest.fn<any>().mockReturnValue({
          select: jest.fn<any>().mockReturnValue({
            lean: jest.fn<any>().mockResolvedValue({
              enterpriseId: 'org456',
              logisticsId: '507f1f77bcf86cd799439012',
            }),
          }),
        }),
        findByIdAndUpdate: jest.fn<any>().mockResolvedValue({
          _id: TEST_SHIPMENT_ID,
          status: 'IN_TRANSIT',
        }),
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
        findById: jest.fn<any>().mockResolvedValue({
          _id: 'user123',
          walletAddress: '0x1234567890abcdef',
        }),
      },
      OrganizationModel: jest.fn(),
      UserRole: {},
      OrganizationType: {},
    }));

    // Build the Express app
    const appModule = await import('../src/app.js');
    app = appModule.buildApp();

    // Create HTTP server with Express app
    httpServer = createServer(app);

    // Initialize Socket.io on the same server
    const { initSocketIO } = await import('../src/infra/socket/io.js');
    initSocketIO(httpServer);

    // Start the server
    await new Promise<void>(resolve => {
      httpServer.listen(TEST_PORT, () => {
        console.log(`[Test Server] Running on port ${TEST_PORT}`);
        resolve();
      });
    });

    // Connect a real socket.io client
    const socketToken = jwt.sign(
      { userId: 'user123', role: 'ADMIN', organizationId: 'org456', jti: randomUUID() },
      process.env.JWT_SECRET!
    );

    socketClient = io(`http://localhost:${TEST_PORT}`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      auth: { token: socketToken },
    });

    // Wait for connection
    await new Promise<void>(resolve => {
      socketClient.on('connect', () => {
        console.log('[Socket Client] Connected');
        resolve();
      });
    });
  }, 60_000);

  afterAll(async () => {
    if (socketClient?.connected) {
      socketClient.disconnect();
    }
    if (httpServer) {
      await new Promise<void>(resolve => {
        httpServer.close(() => resolve());
      });
    }
  });

  describe('HTTP-to-WebSocket Pipeline', () => {
    it('should receive telemetry_update event after joining shipment room and triggering webhook', async () => {
      // Step 1: Join the shipment room
      socketClient.emit('join_shipment', TEST_SHIPMENT_ID);

      // Wait for room join
      await new Promise(resolve => setTimeout(resolve, 100));

      // Step 2: Set up event listener for telemetry_update
      const telemetryUpdatePromise = new Promise<unknown>(resolve => {
        socketClient.on('telemetry_update', (data: any) => {
          resolve(data);
        });
      });

      // Step 3: Trigger the IoT webhook HTTP endpoint
      const body = {
        sensorId: 'sensor-abc-001',
        shipmentId: TEST_SHIPMENT_ID,
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

      // Step 4: Assert the client receives the WebSocket event
      const receivedData = await telemetryUpdatePromise;

      expect(receivedData).toEqual(
        expect.objectContaining({
          shipmentId: TEST_SHIPMENT_ID,
          temperature: 22.5,
          humidity: 55,
          latitude: 12.34,
          longitude: 56.78,
          batteryLevel: 91,
        })
      );
    }, 30_000);

    it('should not receive events for shipment room not joined', async () => {
      const differentShipmentId = '671000000000000000000999';

      // Don't join this shipment room
      const eventReceived: { received: boolean } = { received: false };

      socketClient.on('telemetry_update', (data: any) => {
        // Check if this is for a shipment we didn't join
        if ((data as { shipmentId: string }).shipmentId === differentShipmentId) {
          eventReceived.received = true;
        }
      });

      const body = {
        sensorId: 'sensor-abc-002',
        shipmentId: differentShipmentId,
        temperature: 25.0,
        humidity: 50,
        latitude: 13.34,
        longitude: 57.78,
        batteryLevel: 85,
        timestamp: '2026-01-15T13:30:00.000Z',
      };

      await request(app).post('/api/webhooks/iot').set('x-api-key', 'valid-api-key').send(body);

      // Wait a bit to ensure no event is received
      await new Promise(resolve => setTimeout(resolve, 500));

      expect(eventReceived.received).toBe(false);
    }, 30_000);
  });
});
