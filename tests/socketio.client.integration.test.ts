import { describe, expect, beforeAll, afterAll, it, jest } from '@jest/globals';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { createServer, Server } from 'http';
import { signToken } from './fixtures/factories.js';
import { randomUUID } from 'crypto';
import { generateDataHash } from '../src/shared/utils/crypto.js';
import type { Application } from 'express';
import {
  flushUntilIdle,
  joinShipmentRoom,
  listenOnEphemeralPort,
  teardownSocketSuite,
  waitForSocketEvent,
} from './helpers/flush.js';
import { expectTelemetryPayload } from './helpers/socketContract.js';
import { SOCKET_EVENTS } from '../src/shared/types/socketEvents.js';
import type { TelemetryUpdatePayload } from '../src/shared/types/socketEvents.js';

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
  // The schema defaults this to PENDING_ANCHOR, so the stub must carry it too —
  // otherwise the broadcast contract is asserted against an unfaithful document.
  anchorStatus: 'PENDING_ANCHOR' | 'ANCHORED' | 'ANCHOR_FAILED';
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
  let testPort: number;
  const TEST_SHIPMENT_ID = '671000000000000000000001';

  /**
   * The document the mocked `Telemetry.create` resolves with. Hoisted to
   * describe scope so assertions can state the *exact* payload the server
   * broadcasts rather than a loose subset of it.
   */
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
  const anchoredTxHash = 'mock-tx-hash';

  const mockAnchorTelemetryHash = jest.fn<() => Promise<{ stellarTxHash: string }>>();
  const mockTelemetryCreate = jest.fn<() => Promise<TelemetryCreateResult>>();
  const mockValidateApiKey = jest.fn<() => Promise<ValidateApiKeyResult>>();

  beforeAll(async () => {
    jest.clearAllMocks();

    mockAnchorTelemetryHash.mockResolvedValue({ stellarTxHash: anchoredTxHash });
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
      stellarTxHash: anchoredTxHash,
      anchorStatus: 'PENDING_ANCHOR',
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
    testPort = await listenOnEphemeralPort(httpServer);

    // Connect a real socket.io client
    const socketToken = signToken({
      userId: 'user123',
      role: 'ADMIN',
      organizationId: 'org456',
      jti: randomUUID(),
    });

    socketClient = io(`http://localhost:${testPort}`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      auth: { token: socketToken },
    });

    // Wait for connection
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Socket client did not connect within 10 s')),
        10_000
      );
      socketClient.on('connect', () => {
        clearTimeout(timer);
        console.log('[Socket Client] Connected');
        resolve();
      });
      socketClient.on('connect_error', (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }, 60_000);

  afterAll(async () => {
    await teardownSocketSuite({ socketClient, httpServer });
  });

  describe('HTTP-to-WebSocket Pipeline', () => {
    it('broadcasts the full location:update payload after joining the room and triggering the webhook', async () => {
      // Step 1: Join the shipment room
      await joinShipmentRoom(socketClient, TEST_SHIPMENT_ID);

      // Step 2: Set up event listener for telemetry_update (with timeout so a
      // missed event fails fast instead of hanging until the Jest global timeout)
      const telemetryUpdatePromise = waitForSocketEvent<unknown>(
        socketClient,
        'telemetry_update',
        10_000
      // Step 2: Subscribe to the canonical telemetry event before it is emitted
      const telemetryUpdatePromise = waitForSocketEvent<unknown>(
        socketClient,
        SOCKET_EVENTS.TELEMETRY_UPDATE
      );

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

      // Step 4: Assert the client receives the complete TelemetryUpdatePayload
      const payload: TelemetryUpdatePayload = expectTelemetryPayload(await telemetryUpdatePromise);

      // Exact equality: a renamed, dropped or added required field fails here.
      // `sensorId` falls back to the shipmentId because the stored document and
      // the shipment-scoped webhook body carry no sensorId.
      expect(payload).toEqual({
        telemetryId: 't1',
        shipmentId: TEST_SHIPMENT_ID,
        sensorId: TEST_SHIPMENT_ID,
        temperature: 22.5,
        humidity: 55,
        latitude: 12.34,
        longitude: 56.78,
        batteryLevel: 91,
        timestamp: '2026-01-15T12:30:00.000Z',
        dataHash,
        anchorStatus: 'PENDING_ANCHOR',
        stellarTxHash: anchoredTxHash,
      });
    }, 30_000);

    it('should not receive location:update for a shipment room it never joined', async () => {
      const differentShipmentId = '671000000000000000000999';
      const received: TelemetryUpdatePayload[] = [];
      const listener = (payload: TelemetryUpdatePayload) => {
        received.push(payload);
      };

      // Don't join this shipment room
      socketClient.on(SOCKET_EVENTS.TELEMETRY_UPDATE, listener);

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

      try {
        await request(app).post('/api/webhooks/iot').set('x-api-key', 'valid-api-key').send(body);

        // Let the webhook's async emit settle, then round-trip the socket so any
        // room broadcast queued before it has been delivered.
        await flushUntilIdle();
        const left = waitForSocketEvent(socketClient, 'room_left');
        socketClient.emit('leave_shipment', differentShipmentId);
        await left;
      } finally {
        socketClient.off(SOCKET_EVENTS.TELEMETRY_UPDATE, listener);
      }

      expect(received.filter(entry => entry.shipmentId === differentShipmentId)).toEqual([]);
    }, 30_000);
  });
});
