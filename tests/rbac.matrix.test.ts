import { describe, expect, beforeAll, afterAll, it, jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import mongoose from 'mongoose';
import type { Application } from 'express';
import { env } from '../src/env.js';

const UserRole = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  MANAGER: 'MANAGER',
  VIEWER: 'VIEWER',
  CUSTOMER: 'CUSTOMER',
} as const;

// Role definitions for the matrix
const ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.VIEWER,
  UserRole.CUSTOMER,
] as const;

type Role = (typeof ROLES)[number];

// Define which roles can access which endpoints
const RBAC_MATRIX: Record<string, Role[]> = {
  // Users - only admins can manage users (GET route not implemented)
  'POST /api/users': [UserRole.SUPER_ADMIN, UserRole.ADMIN],
  'DELETE /api/users/:id': [UserRole.SUPER_ADMIN, UserRole.ADMIN],

  // Shipments - managers+ can modify, viewers can read
  'GET /api/shipments': [
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.VIEWER,
    UserRole.CUSTOMER,
  ],
  'POST /api/shipments': [UserRole.ADMIN, UserRole.MANAGER],
  'PATCH /api/shipments/:id': [UserRole.ADMIN, UserRole.MANAGER],
  'DELETE /api/shipments/:id': [UserRole.SUPER_ADMIN, UserRole.ADMIN],

  // Analytics - managers+ can access
  'GET /api/analytics/performance': [UserRole.ADMIN, UserRole.MANAGER],

  // Anomalies - admins and managers only
  'GET /api/anomalies': [UserRole.ADMIN, UserRole.MANAGER],
  'PATCH /api/anomalies/:id/resolve': [UserRole.ADMIN, UserRole.MANAGER],

  // Telemetry - public read endpoint
  'GET /api/telemetry': [
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.VIEWER,
    UserRole.CUSTOMER,
    'PUBLIC' as Role,
  ],

  // Health - public
  'GET /api/health': ['PUBLIC' as Role],

  // Webhooks - IoT webhook uses API key, not user auth
  'POST /api/webhooks/iot': ['API_KEY' as Role],
};

describe('RBAC Matrix Integration Tests', () => {
  let app: Application;
  let testUserIds: Record<Role, string>;
  let testOrganizationId: string;
  // Mock dependencies
  const mockUserFind = jest.fn<any>();
  const mockUserFindOne = jest.fn<any>();
  const mockUserCreate = jest.fn<any>();
  const mockUserFindById = jest.fn<any>();
  const mockShipmentFind = jest.fn<any>();
  const mockShipmentCreate = jest.fn<any>();
  const mockShipmentFindByIdAndUpdate = jest.fn<any>();
  const mockTelemetryFind = jest.fn<any>();
  const mockAnomalyFind = jest.fn<any>();
  const mockAnomalyFindByIdAndUpdate = jest.fn<any>();
  const mockAnalyticsAggregate = jest.fn<any>();
  const mockApiKeyFindOne = jest.fn<any>();

  beforeAll(async () => {
    testOrganizationId = new mongoose.Types.ObjectId().toString();
    testUserIds = {} as Record<Role, string>;

    // Create test users for each role
    for (const role of ROLES) {
      const userId = new mongoose.Types.ObjectId().toString();
      testUserIds[role] = userId;
    }

    // Setup mocks
    await jest.unstable_mockModule('../src/infra/redis/tokenBlocklist.js', () => ({
      isTokenBlocked: jest.fn<any>().mockResolvedValue(false),
      blockToken: jest.fn<any>().mockResolvedValue(undefined),
    }));

    await jest.unstable_mockModule('../src/modules/telemetry/telemetry.service.js', () => ({
      getTelemetryService: jest.fn<any>().mockResolvedValue({
        data: [],
        nextCursor: null,
        hasMore: false,
      }),
      createTelemetryRecord: jest.fn<any>(),
      findActiveShipmentBySensorId: jest.fn<any>(),
      updateTelemetryAnchor: jest.fn<any>(),
      markTelemetryAnchorFailed: jest.fn<any>(),
      bulkIngestTelemetry: jest.fn<any>().mockResolvedValue([]),
      getTelemetryThresholds: jest
        .fn<any>()
        .mockReturnValue({ minBatteryLevel: 20, maxTemperature: 25, maxHumidity: 80 }),
    }));

    await jest.unstable_mockModule('../src/modules/anomaly/anomaly.service.js', () => ({
      getAnomaliesService: jest.fn<any>().mockResolvedValue({
        data: [],
        nextCursor: null,
        hasMore: false,
      }),
      resolveAnomalyService: jest
        .fn<any>()
        .mockResolvedValue({ _id: 'anomaly-1', status: 'RESOLVED' }),
      detectAnomaly: jest.fn<any>().mockResolvedValue({ detected: false, anomalies: [] }),
    }));

    await jest.unstable_mockModule('../src/modules/shipments/shipments.service.js', () => ({
      getShipmentsService: jest.fn<any>().mockResolvedValue({
        data: [],
        nextCursor: null,
        hasMore: false,
      }),
      createShipmentService: jest.fn<any>().mockResolvedValue({ _id: 'shipment-1' }),
      patchShipmentService: jest
        .fn<any>()
        .mockResolvedValue({ _id: 'shipment-1', status: 'IN_TRANSIT' }),
      updateShipmentStatusService: jest
        .fn<any>()
        .mockResolvedValue({ _id: 'shipment-1', status: 'IN_TRANSIT' }),
      uploadShipmentProofService: jest.fn<any>(),
      deleteShipmentService: jest.fn<any>(),
      findShipments: jest.fn<any>(),
    }));

    await jest.unstable_mockModule('../src/infra/redis/queue.js', () => ({
      pushAlertJob: jest.fn<any>().mockResolvedValue(undefined),
      pushStellarAnchorJob: jest.fn<any>().mockResolvedValue(undefined),
      getTransactionQueue: jest.fn<any>(),
      getRedisClient: jest.fn<any>(),
    }));

    await jest.unstable_mockModule('../src/infra/socket/io.js', () => ({
      emitTelemetryUpdate: jest.fn(),
      emitAnomalyDetected: jest.fn(),
      emitStatusUpdate: jest.fn(),
      initSocketIO: jest.fn(),
      getIO: jest.fn(),
      closeSocketIO: jest.fn(async () => undefined),
    }));

    await jest.unstable_mockModule('../src/modules/users/users.model.js', () => ({
      UserModel: {
        find: mockUserFind,
        findOne: mockUserFindOne,
        create: mockUserCreate,
        findById: mockUserFindById,
      },
      UserRole: {
        SUPER_ADMIN: 'SUPER_ADMIN',
        ADMIN: 'ADMIN',
        MANAGER: 'MANAGER',
        VIEWER: 'VIEWER',
        CUSTOMER: 'CUSTOMER',
      },
      OrganizationType: {},
      OrganizationModel: {
        findById: jest.fn(),
      },
    }));

    await jest.unstable_mockModule('../src/modules/shipments/shipments.model.js', () => ({
      Shipment: {
        find: mockShipmentFind,
        create: mockShipmentCreate,
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

    await jest.unstable_mockModule('../src/modules/telemetry/telemetry.model.js', () => ({
      Telemetry: {
        find: mockTelemetryFind,
      },
      TelemetryAnchorStatus: {},
    }));

    await jest.unstable_mockModule('../src/modules/anomaly/anomaly.model.js', () => ({
      Anomaly: {
        find: mockAnomalyFind,
        findByIdAndUpdate: mockAnomalyFindByIdAndUpdate,
      },
      AnomalySeverity: {
        LOW: 'LOW',
        MEDIUM: 'MEDIUM',
        HIGH: 'HIGH',
      },
      AnomalyStatus: {
        DETECTED: 'DETECTED',
        INVESTIGATING: 'INVESTIGATING',
        RESOLVED: 'RESOLVED',
      },
    }));

    await jest.unstable_mockModule('../src/modules/analytics/analytics.service.js', () => ({
      getAnalyticsPerformance: mockAnalyticsAggregate,
    }));

    await jest.unstable_mockModule('../src/modules/users/users.service.js', () => ({
      registerUser: jest.fn<any>().mockResolvedValue({
        _id: 'user-new',
        email: 'newuser@test.com',
        name: 'New User',
      }),
    }));

    await jest.unstable_mockModule('../src/modules/webhooks/iot.service.js', () => ({
      processIotWebhook: jest
        .fn<any>()
        .mockResolvedValue({ _id: 'telemetry-1', shipmentId: 'shipment-1' }),
    }));

    await jest.unstable_mockModule('../src/modules/auth/apiKey.service.js', () => ({
      validateApiKey: mockApiKeyFindOne,
      generateApiKey: jest.fn<any>(),
      revokeApiKey: jest.fn<any>(),
      listApiKeys: jest.fn<any>(),
    }));

    // Build the app
    const appModule = await import('../src/app.js');
    app = appModule.buildApp();

    // Setup default mock responses
    (mockUserFind as any).mockReturnValue({
      limit: jest.fn<any>().mockResolvedValue([]),
      skip: jest.fn<any>().mockResolvedValue([]),
      sort: jest.fn<any>().mockReturnValue({
        limit: jest.fn<any>().mockResolvedValue([]),
        skip: jest.fn<any>().mockResolvedValue([]),
      }),
    });

    (mockShipmentFind as any).mockReturnValue({
      limit: jest.fn<any>().mockResolvedValue([]),
      skip: jest.fn<any>().mockResolvedValue([]),
      sort: jest.fn<any>().mockReturnValue({
        limit: jest.fn<any>().mockResolvedValue([]),
        skip: jest.fn<any>().mockResolvedValue([]),
      }),
    });

    (mockTelemetryFind as any).mockReturnValue({
      limit: jest.fn<any>().mockResolvedValue([]),
      skip: jest.fn<any>().mockResolvedValue([]),
    });

    (mockAnomalyFind as any).mockReturnValue({
      limit: jest.fn<any>().mockResolvedValue([]),
      skip: jest.fn<any>().mockResolvedValue([]),
    });

    (mockAnalyticsAggregate as any).mockResolvedValue({
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-01-31T23:59:59.999Z',
      shipmentsByStatus: [],
      averageDeliveryTimeByLogisticsId: [],
      totalDelayedShipments: 0,
    });
    (mockApiKeyFindOne as any).mockResolvedValue({ isValid: true });
  }, 60_000);

  afterAll(() => {
    jest.clearAllMocks();
  });

  /**
   * Generate a valid JWT token for a specific role
   */
  function generateToken(role: Role): string {
    const payload = {
      userId: testUserIds[role],
      role,
      organizationId: testOrganizationId,
      jti: randomUUID(),
    };
    return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '1h' });
  }

  describe('Role-Based Access Control Matrix', () => {
    // Test POST /api/users (admin-only user creation)
    describe('POST /api/users', () => {
      for (const role of ROLES) {
        const allowedRoles = RBAC_MATRIX['POST /api/users'];
        const shouldAllow = allowedRoles.includes(role);

        it(`${role} ${shouldAllow ? 'should access' : 'should NOT access'} POST /api/users`, async () => {
          const token = generateToken(role);

          const res = await request(app)
            .post('/api/users')
            .set('Authorization', `Bearer ${token}`)
            .send({ email: 'newuser@test.com', name: 'New User' });

          if (shouldAllow) {
            expect([201, 400, 409]).toContain(res.status);
          } else {
            expect(res.status).toBe(403);
          }
        });
      }

      it('should reject unauthenticated requests with 401', async () => {
        const res = await request(app)
          .post('/api/users')
          .send({ email: 'newuser@test.com', name: 'New User' });

        expect(res.status).toBe(401);
      });
    });

    // Test POST /api/shipments (create)
    describe('POST /api/shipments', () => {
      for (const role of ROLES) {
        const allowedRoles = RBAC_MATRIX['POST /api/shipments'];
        const shouldAllow = allowedRoles.includes(role);

        it(`${role} ${shouldAllow ? 'should access' : 'should NOT access'} POST /api/shipments`, async () => {
          const token = generateToken(role);

          const res = await request(app)
            .post('/api/shipments')
            .set('Authorization', `Bearer ${token}`)
            .send({
              origin: { address: 'Origin Address', city: 'Origin City', country: 'US' },
              destination: { address: 'Dest Address', city: 'Dest City', country: 'US' },
              estimatedDelivery: '2026-02-01T00:00:00.000Z',
            });

          if (shouldAllow) {
            expect([201, 400, 404]).toContain(res.status);
          } else {
            expect(res.status).toBe(403);
          }
        });
      }
    });

    // Test PATCH /api/shipments/:id (update)
    describe('PATCH /api/shipments/:id', () => {
      const shipmentId = new mongoose.Types.ObjectId().toString();

      for (const role of ROLES) {
        const allowedRoles = RBAC_MATRIX['PATCH /api/shipments/:id'];
        const shouldAllow = allowedRoles.includes(role);

        it(`${role} ${shouldAllow ? 'should access' : 'should NOT access'} PATCH /api/shipments/:id`, async () => {
          const token = generateToken(role);

          const res = await request(app)
            .patch(`/api/shipments/${shipmentId}`)
            .set('Authorization', `Bearer ${token}`)
            .send({ offChainMetadata: { note: 'updated' } });

          if (shouldAllow) {
            expect([200, 404]).toContain(res.status);
          } else {
            expect(res.status).toBe(403);
          }
        });
      }
    });

    // Test GET /api/analytics/performance
    describe('GET /api/analytics/performance', () => {
      for (const role of ROLES) {
        const allowedRoles = RBAC_MATRIX['GET /api/analytics/performance'];
        const shouldAllow = allowedRoles.includes(role);

        it(`${role} ${shouldAllow ? 'should access' : 'should NOT access'} GET /api/analytics/performance`, async () => {
          const token = generateToken(role);

          const res = await request(app)
            .get('/api/analytics/performance')
            .query({ startDate: '2026-01-01T00:00:00.000Z', endDate: '2026-01-31T23:59:59.999Z' })
            .set('Authorization', `Bearer ${token}`);

          if (shouldAllow) {
            expect([200, 400]).toContain(res.status);
          } else {
            expect(res.status).toBe(403);
          }
        });
      }
    });

    // Test GET /api/anomalies
    describe('GET /api/anomalies', () => {
      for (const role of ROLES) {
        const allowedRoles = RBAC_MATRIX['GET /api/anomalies'];
        const shouldAllow = allowedRoles.includes(role);

        it(`${role} ${shouldAllow ? 'should access' : 'should NOT access'} GET /api/anomalies`, async () => {
          const token = generateToken(role);

          const res = await request(app)
            .get('/api/anomalies')
            .set('Authorization', `Bearer ${token}`);

          if (shouldAllow) {
            expect([200, 404]).toContain(res.status);
          } else {
            expect(res.status).toBe(403);
          }
        });
      }
    });

    // Test PATCH /api/anomalies/:id/resolve (update anomaly)
    describe('PATCH /api/anomalies/:id/resolve', () => {
      const anomalyId = new mongoose.Types.ObjectId().toString();

      for (const role of ROLES) {
        const allowedRoles = RBAC_MATRIX['PATCH /api/anomalies/:id/resolve'];
        const shouldAllow = allowedRoles.includes(role);

        it(`${role} ${shouldAllow ? 'should access' : 'should NOT access'} PATCH /api/anomalies/:id/resolve`, async () => {
          const token = generateToken(role);

          const res = await request(app)
            .patch(`/api/anomalies/${anomalyId}/resolve`)
            .set('Authorization', `Bearer ${token}`)
            .send({ status: 'RESOLVED' });

          if (shouldAllow) {
            expect([200, 404]).toContain(res.status);
          } else {
            expect(res.status).toBe(403);
          }
        });
      }
    });

    // Test GET /api/telemetry
    describe('GET /api/telemetry', () => {
      for (const role of ROLES) {
        const allowedRoles = RBAC_MATRIX['GET /api/telemetry'];
        const shouldAllow = allowedRoles.includes(role);

        it(`${role} ${shouldAllow ? 'should access' : 'should NOT access'} GET /api/telemetry`, async () => {
          const token = generateToken(role);

          const res = await request(app)
            .get('/api/telemetry')
            .set('Authorization', `Bearer ${token}`);

          if (shouldAllow) {
            expect([200, 404]).toContain(res.status);
          } else {
            expect(res.status).toBe(403);
          }
        });
      }
    });

    // Test GET /api/health (public endpoint)
    describe('GET /api/health', () => {
      it('should be accessible without authentication', async () => {
        const res = await request(app).get('/api/health');
        expect(res.status).toBe(200);
      });
    });

    // Test POST /api/webhooks/iot (API key auth)
    describe('POST /api/webhooks/iot', () => {
      it('should accept valid API key', async () => {
        (mockApiKeyFindOne as any).mockResolvedValueOnce({
          isValid: true,
          apiKeyDoc: {
            _id: 'key123',
            organizationId: testOrganizationId,
            shipmentId: new mongoose.Types.ObjectId().toString(),
          },
        });

        const res = await request(app)
          .post('/api/webhooks/iot')
          .set('x-api-key', 'valid-api-key')
          .send({
            sensorId: 'sensor-001',
            shipmentId: new mongoose.Types.ObjectId().toString(),
            temperature: 20,
            humidity: 50,
            latitude: 0,
            longitude: 0,
            batteryLevel: 100,
            timestamp: new Date().toISOString(),
          });

        expect(res.status).toBe(202);
      });

      it('should reject invalid API key', async () => {
        (mockApiKeyFindOne as any).mockResolvedValueOnce({ isValid: false });

        const res = await request(app)
          .post('/api/webhooks/iot')
          .set('x-api-key', 'invalid-key')
          .send({
            sensorId: 'sensor-001',
            shipmentId: new mongoose.Types.ObjectId().toString(),
            temperature: 20,
            humidity: 50,
            latitude: 0,
            longitude: 0,
            batteryLevel: 100,
            timestamp: new Date().toISOString(),
          });

        expect(res.status).toBe(401);
      });
    });
  });

  describe('Viewer Role Restrictions', () => {
    it('VIEWER should NOT be able to create shipments', async () => {
      const token = generateToken(UserRole.VIEWER);

      const res = await request(app)
        .post('/api/shipments')
        .set('Authorization', `Bearer ${token}`)
        .send({
          origin: { address: 'Test', city: 'Test', country: 'US' },
          destination: { address: 'Test', city: 'Test', country: 'US' },
        });

      expect(res.status).toBe(403);
    });

    it('VIEWER should NOT be able to update shipments', async () => {
      const token = generateToken(UserRole.VIEWER);
      const shipmentId = new mongoose.Types.ObjectId().toString();

      const res = await request(app)
        .patch(`/api/shipments/${shipmentId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'DELIVERED' });

      expect(res.status).toBe(403);
    });

    it('VIEWER should NOT be able to create users (admin-only endpoint)', async () => {
      const token = generateToken(UserRole.VIEWER);

      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${token}`)
        .send({
          email: 'newuser@test.com',
          name: 'New User',
          password: 'password123',
          role: UserRole.VIEWER,
        });

      expect(res.status).toBe(403);
    });

    it('VIEWER should be able to read shipments', async () => {
      const token = generateToken(UserRole.VIEWER);

      const res = await request(app).get('/api/shipments').set('Authorization', `Bearer ${token}`);

      expect([200, 404]).toContain(res.status);
    });

    it('VIEWER should NOT be able to read anomalies', async () => {
      const token = generateToken(UserRole.VIEWER);

      const res = await request(app).get('/api/anomalies').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
    });
  });

  describe('Customer Role Restrictions', () => {
    it('CUSTOMER should NOT be able to access analytics', async () => {
      const token = generateToken(UserRole.CUSTOMER);

      const res = await request(app)
        .get('/api/analytics/performance')
        .query({ startDate: '2026-01-01T00:00:00.000Z', endDate: '2026-01-31T23:59:59.999Z' })
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
    });

    it('CUSTOMER should NOT be able to create shipments', async () => {
      const token = generateToken(UserRole.CUSTOMER);

      const res = await request(app)
        .post('/api/shipments')
        .set('Authorization', `Bearer ${token}`)
        .send({
          origin: { address: 'Test', city: 'Test', country: 'US' },
          destination: { address: 'Test', city: 'Test', country: 'US' },
        });

      expect(res.status).toBe(403);
    });

    it('CUSTOMER should be able to read telemetry', async () => {
      const token = generateToken(UserRole.CUSTOMER);

      const res = await request(app).get('/api/telemetry').set('Authorization', `Bearer ${token}`);

      expect([200, 404]).toContain(res.status);
    });
  });

  describe('Unauthorized Access', () => {
    it('should reject requests without authentication', async () => {
      const endpoints: Array<[string, string, boolean]> = [
        ['GET', '/api/shipments', true],
        ['GET', '/api/analytics/performance', true],
        ['GET', '/api/anomalies', true],
        ['GET', '/api/telemetry', true],
      ];

      for (const [method, path, requiresAuth] of endpoints) {
        const res =
          path === '/api/analytics/performance'
            ? await request(app)
                .get(path)
                .query({
                  startDate: '2026-01-01T00:00:00.000Z',
                  endDate: '2026-01-31T23:59:59.999Z',
                })
            : await request(app).get(path);

        if (requiresAuth) {
          expect(res.status).toBe(401);
        } else {
          expect([200, 400]).toContain(res.status);
        }
      }
    });

    it('should reject requests with invalid token', async () => {
      const res = await request(app)
        .get('/api/shipments')
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
    });
  });
});
