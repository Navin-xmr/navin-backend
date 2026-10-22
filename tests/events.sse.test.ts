import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';
import { EventEmitter } from 'events';
import { buildApp } from '../src/app.js';
import {
  deliverToUserForTest,
  getSseClientCount,
  registerSseClient,
  resetSseHubForTest,
} from '../src/infra/sse/sseHub.js';
import type { RealtimeEvent } from '../src/shared/types/realtimeEvents.js';
import { SOCKET_EVENTS } from '../src/shared/types/socketEvents.js';

const JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars-long!';
const TEST_USER_ID = new Types.ObjectId().toString();
const TEST_ORGANIZATION_ID = new Types.ObjectId().toString();
const TEST_SHIPMENT_ID = new Types.ObjectId().toString();

function createMockResponse(): Response & EventEmitter {
  const emitter = new EventEmitter();
  const chunks: string[] = [];

  const res = Object.assign(emitter, {
    writableEnded: false,
    writeHead: jest.fn((_status: number, _headers: Record<string, string>) => undefined),
    write: jest.fn((chunk: string) => {
      chunks.push(chunk);
      return true;
    }),
    end: jest.fn(() => {
      (res as { writableEnded: boolean }).writableEnded = true;
    }),
    get chunks() {
      return chunks;
    },
  }) as unknown as Response & EventEmitter & { chunks: string[] };

  return res;
}

function signToken(overrides: Record<string, unknown> = {}): string {
  return jwt.sign(
    {
      userId: TEST_USER_ID,
      role: 'ADMIN',
      organizationId: TEST_ORGANIZATION_ID,
      jti: '550e8400-e29b-41d4-a716-446655440000',
      ...overrides,
    },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

describe('GET /api/events — SSE endpoint', () => {
  const app = buildApp();

  beforeEach(() => {
    resetSseHubForTest();
  });

  afterEach(() => {
    resetSseHubForTest();
  });

  describe('authentication', () => {
    it('returns 401 when no token is provided', async () => {
      const res = await request(app).get('/api/events');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 401 for an invalid token', async () => {
      const res = await request(app)
        .get('/api/events')
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 401 when token is revoked', async () => {
      const store = new Map<string, string>();
      await jest.unstable_mockModule('../src/infra/redis/connection.js', () => ({
        getRedisClient: () => ({
          get: async (key: string) => store.get(key) ?? null,
          set: async (key: string, value: string) => {
            store.set(key, value);
            return 'OK';
          },
        }),
        getRedisConnection: () => ({
          get: async (key: string) => store.get(key) ?? null,
        }),
        disconnectRedis: jest.fn(),
      }));

      jest.resetModules();
      const { blockToken } = await import('../src/infra/redis/tokenBlocklist.js');
      await blockToken('550e8400-e29b-41d4-a716-446655440000', 3600);

      const token = signToken();
      const res = await request(app)
        .get('/api/events')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('TOKEN_REVOKED');
    });

    it('accepts JWT via Authorization header', async () => {
      const { requireSseAuth } = await import('../src/shared/middleware/requireSseAuth.js');
      const token = signToken();
      const req = {
        headers: { authorization: `Bearer ${token}` },
        query: {},
      } as unknown as Request;

      const next = jest.fn() as jest.MockedFunction<NextFunction>;
      await requireSseAuth(req, {} as Response, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.user?.userId).toBe(TEST_USER_ID);
    });

    it('accepts JWT via ?token= query parameter', async () => {
      const { requireSseAuth } = await import('../src/shared/middleware/requireSseAuth.js');
      const token = signToken();
      const req = {
        headers: {},
        query: { token },
      } as unknown as Request;

      const next = jest.fn() as jest.MockedFunction<NextFunction>;
      await requireSseAuth(req, {} as Response, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.user?.userId).toBe(TEST_USER_ID);
    });
  });

  describe('SSE stream behavior', () => {
    it('sets text/event-stream headers and sends connected comment', () => {
      const res = createMockResponse();
      registerSseClient(TEST_USER_ID, res);

      expect(res.writeHead).toHaveBeenCalledWith(
        200,
        expect.objectContaining({
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        })
      );
      expect(res.chunks.join('')).toContain(': connected');
      expect(getSseClientCount(TEST_USER_ID)).toBe(1);
    });

    it('delivers typed events to connected clients', () => {
      const res = createMockResponse();
      registerSseClient(TEST_USER_ID, res);

      const event: RealtimeEvent = {
        type: SOCKET_EVENTS.SHIPMENT_STATUS,
        shipmentId: TEST_SHIPMENT_ID,
        newStatus: 'IN_TRANSIT',
        timestamp: '2026-01-15T12:00:00.000Z',
      };

      deliverToUserForTest(TEST_USER_ID, event);

      const output = res.chunks.join('');
      expect(output).toContain(`event: ${SOCKET_EVENTS.SHIPMENT_STATUS}`);
      expect(output).toContain('"newStatus":"IN_TRANSIT"');
    });

    it('sends heartbeat comments every 30 seconds', () => {
      jest.useFakeTimers();
      const res = createMockResponse();
      registerSseClient(TEST_USER_ID, res);

      const initialChunks = res.chunks.length;
      jest.advanceTimersByTime(30_000);

      expect(res.chunks.length).toBeGreaterThan(initialChunks);
      expect(res.chunks.at(-1)).toBe(': heartbeat\n\n');

      jest.useRealTimers();
    });

    it('removes client on close', () => {
      const res = createMockResponse();
      registerSseClient(TEST_USER_ID, res);
      expect(getSseClientCount(TEST_USER_ID)).toBe(1);

      res.emit('close');
      expect(getSseClientCount(TEST_USER_ID)).toBe(0);
    });
  });
});
