import { jest, describe, beforeAll, beforeEach, it, expect } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Application } from 'express';

// Mock in-memory DB for shipments
type ShipmentRecord = {
  _id: string;
  trackingNumber: string;
  origin: string;
  destination: string;
  status?: string;
  milestones: Record<string, unknown>[];
} & Record<string, unknown>;

const shipmentsData: ShipmentRecord[] = [];

await jest.unstable_mockModule('../src/modules/shipments/shipments.model.js', () => {
  type ShipmentQuery = {
    _id?: { $lt?: string };
    status?: string;
    origin?: { $regex: string; $options: string };
    destination?: { $regex: string; $options: string };
  };

  const ShipmentStatus = {
    CREATED: 'CREATED',
    IN_TRANSIT: 'IN_TRANSIT',
    DELIVERED: 'DELIVERED',
    CANCELLED: 'CANCELLED',
  };

  const applyFilters = (query: ShipmentQuery) => {
    let filtered = [...shipmentsData];
    if (query.status) {
      filtered = filtered.filter(s => s.status === query.status);
    }
    if (query._id?.$lt) {
      filtered = filtered.filter(s => s._id < query._id!.$lt!);
    }
    if (query.origin) {
      const regex = new RegExp(query.origin.$regex, query.origin.$options);
      filtered = filtered.filter(s => regex.test(s.origin));
    }
    if (query.destination) {
      const regex = new RegExp(query.destination.$regex, query.destination.$options);
      filtered = filtered.filter(s => regex.test(s.destination));
    }
    return filtered;
  };

  const Shipment = {
    find: (query: ShipmentQuery = {}) => ({
      sort: () => ({
        skip: (skip: number) => ({
          limit: (limit: number) => ({
            lean: () => Promise.resolve(applyFilters(query).slice(skip, skip + limit)),
          }),
        }),
        limit: (limit: number) => ({
          lean: () => Promise.resolve(applyFilters(query).slice(0, limit)),
        }),
      }),
    }),
    countDocuments: (query: ShipmentQuery = {}) => Promise.resolve(applyFilters(query).length),
    deleteMany: () => {
      shipmentsData.length = 0;
      return Promise.resolve();
    },
  };

  return { Shipment, ShipmentStatus };
});

// Mock other dependencies
await jest.unstable_mockModule('../src/services/stellar.service.js', () => ({
  tokenizeShipment: jest.fn(() =>
    Promise.resolve({ stellarTokenId: 'test', stellarTxHash: 'test' })
  ),
  anchorTelemetryHash: jest.fn(() => Promise.resolve({ stellarTxHash: 'test' })),
  releaseEscrow: jest.fn(() => Promise.resolve({ success: true, transactionHash: 'test' })),
  getStellarExplorerUrl: jest.fn(() => 'https://stellar.expert/explorer/testnet/tx/mock'),
}));

await jest.unstable_mockModule('../src/infra/socket/io.js', () => ({
  emitStatusUpdate: jest.fn(),
  emitAnomalyDetected: jest.fn(),
  emitTelemetryUpdate: jest.fn(),
  initSocketIO: jest.fn(),
  getIO: jest.fn(),
}));

await jest.unstable_mockModule('../src/modules/users/users.model.js', () => ({
  UserModel: {
    findById: jest.fn(() => Promise.resolve(null)),
  },
  OrganizationModel: {
    find: jest.fn(() => Promise.resolve([])),
    findById: jest.fn(() => Promise.resolve(null)),
  },
  UserRole: {
    SUPER_ADMIN: 'SUPER_ADMIN',
    ADMIN: 'ADMIN',
    MANAGER: 'MANAGER',
  },
  OrganizationType: {
    ENTERPRISE: 'ENTERPRISE',
    LOGISTICS: 'LOGISTICS',
  },
}));

await jest.unstable_mockModule('../src/services/mockStorageService.js', () => ({
  mockUploadToStorage: jest.fn(() => Promise.resolve('http://fake-url.com/file')),
}));

// Mock middleware dependencies
await jest.unstable_mockModule('../src/shared/middleware/rateLimiter.js', () => ({
  standardLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  strictLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  loginLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

await jest.unstable_mockModule('../src/infra/mongo/connection.js', () => ({
  connectDB: jest.fn(() => Promise.resolve()),
}));

const { buildApp } = await import('../src/app.js');

describe('Shipments Search Filters', () => {
  let app: Application;
  let authToken: string;

  beforeAll(async () => {
    app = buildApp();
    authToken = jwt.sign({ userId: 'test-user-id', role: 'ADMIN' }, process.env.JWT_SECRET!);
  });

  beforeEach(async () => {
    shipmentsData.length = 0;

    // Seed test data
    shipmentsData.push(
      {
        _id: '1',
        trackingNumber: 'TRK001',
        origin: 'New York, NY',
        destination: 'Los Angeles, CA',
        status: 'IN_TRANSIT',
        milestones: [],
      },
      {
        _id: '2',
        trackingNumber: 'TRK002',
        origin: 'Chicago, IL',
        destination: 'Miami, FL',
        status: 'DELIVERED',
        milestones: [],
      },
      {
        _id: '3',
        trackingNumber: 'TRK003',
        origin: 'San Francisco, CA',
        destination: 'New York, NY',
        status: 'CREATED',
        milestones: [],
      },
      {
        _id: '4',
        trackingNumber: 'TRK004',
        origin: 'Boston, MA',
        destination: 'Seattle, WA',
        status: 'IN_TRANSIT',
        milestones: [],
      }
    );
  });

  describe('GET /api/shipments with origin filter', () => {
    it('should filter shipments by partial origin match (case-insensitive)', async () => {
      const response = await request(app)
        .get('/api/shipments?origin=new')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].origin).toBe('New York, NY');
    });

    it('should filter shipments by exact city name', async () => {
      const response = await request(app)
        .get('/api/shipments?origin=Chicago')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].origin).toBe('Chicago, IL');
    });

    it('should return empty array for non-matching origin', async () => {
      const response = await request(app)
        .get('/api/shipments?origin=NonExistent')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(0);
    });
  });

  describe('GET /api/shipments with destination filter', () => {
    it('should filter shipments by partial destination match (case-insensitive)', async () => {
      const response = await request(app)
        .get('/api/shipments?destination=angeles')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].destination).toBe('Los Angeles, CA');
    });

    it('should filter shipments by state abbreviation', async () => {
      const response = await request(app)
        .get('/api/shipments?destination=FL')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].destination).toBe('Miami, FL');
    });
  });

  describe('GET /api/shipments with combined filters', () => {
    it('should filter by both origin and destination', async () => {
      const response = await request(app)
        .get('/api/shipments?origin=San&destination=New')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].origin).toBe('San Francisco, CA');
      expect(response.body.data[0].destination).toBe('New York, NY');
    });

    it('should combine origin filter with status filter', async () => {
      const response = await request(app)
        .get('/api/shipments?origin=York&status=IN_TRANSIT')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].status).toBe('IN_TRANSIT');
    });

    it('should return empty when filters do not match any shipment', async () => {
      const response = await request(app)
        .get('/api/shipments?origin=New&destination=Seattle')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(0);
    });
  });

  describe('GET /api/shipments validation', () => {
    it('should accept valid query parameters', async () => {
      const response = await request(app)
        .get('/api/shipments?origin=test&destination=test&status=CREATED&limit=10')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.body.success).toBe(true);
    });

    it('should reject invalid limit values', async () => {
      await request(app)
        .get('/api/shipments?limit=0')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);

      await request(app)
        .get('/api/shipments?limit=101')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });

    it('should use default limit when not provided', async () => {
      const response = await request(app)
        .get('/api/shipments')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.body.success).toBe(true);
      // Should return all 4 test shipments since default limit is 20
      expect(response.body.data).toHaveLength(4);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty origin/destination strings', async () => {
      const response = await request(app)
        .get('/api/shipments?origin=&destination=')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(4); // Should return all shipments
    });

    it('should handle special regex characters in search', async () => {
      // Add a shipment with special characters
      shipmentsData.push({
        _id: '5',
        trackingNumber: 'TRK005',
        origin: 'Test (City)',
        destination: 'Test [Destination]',
        status: 'CREATED',
        milestones: [],
      });

      const response = await request(app)
        .get('/api/shipments?origin=Test (City)')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
    });
  });
});
