/**
 * SSE endpoint tests.
 *
 * Fixes applied in this file:
 *   #764 — Mock registration order: resetModules → unstable_mockModule →
 *           dynamic import is now inside beforeEach so every test gets a
 *           clean module registry with the Redis mock already registered
 *           before tokenBlocklist (and therefore requireSseAuth) is loaded.
 *
 *   #765 — Revoked-token assertion now checks the canonical error envelope
 *           path `res.body.error.code` with value `'ERR_AUTH_TOKEN_REVOKED'`
 *           instead of the stale `res.body.code === 'TOKEN_REVOKED'`.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, jest } from '@jest/globals';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';
import { EventEmitter } from 'events';
import type { RealtimeEvent } from '../src/shared/types/realtimeEvents.js';
import { redisMock } from './fixtures/factories.js';

// ── Types ────────────────────────────────────────────────────────────────────

type BlockToken = (jti: string, ttlSeconds: number) => Promise<void>;
type RequireSseAuth = (req: Request, res: Response, next: NextFunction) => Promise<void>;
type DeliverToUserForTest = (userId: string, event: RealtimeEvent) => void;
type GetSseClientCount = (userId: string) => number;
type RegisterSseClient = (userId: string, res: Response) => void;
type ResetSseHubForTest = () => void;
type SignToken = (claims?: Record<string, unknown>, options?: { expiresIn?: string }) => string;

// ── Constants ─────────────────────────────────────────────────────────────────

const VALID_JTI = '550e8400-e29b-41d4-a716-446655440000';
const REVOKED_JTI = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Test suite ────────────────────────────────────────────────────────────────

describe('GET /api/events — SSE endpoint', () => {
  // Populated inside beforeEach after dynamic imports.
  let app: ReturnType<import('../src/app.js')['buildApp']>;
  let blockToken: BlockToken;
  let requireSseAuth: RequireSseAuth;
  let deliverToUserForTest: DeliverToUserForTest;
  let getSseClientCount: GetSseClientCount;
  let registerSseClient: RegisterSseClient;
  let resetSseHubForTest: ResetSseHubForTest;
  let signJwt: SignToken;

  // One in-memory Redis store shared across the suite; cleared in beforeEach.
  const redisStore = new Map<string, string>();

  // #764: The CORRECT order is reset → register mocks → dynamic import.
  // Running this inside beforeEach ensures every test starts from a clean
  // module registry with the Redis mock already in place before any module
  // that uses Redis (tokenBlocklist, requireSseAuth) is imported.
  beforeEach(async () => {
    redisStore.clear();

    // 1. Wipe the module registry so stale cached modules don't bleed through.
    jest.resetModules();

    // 2. Register the in-memory Redis mock BEFORE any module that depends on it
    //    is imported.  tokenBlocklist (and therefore requireSseAuth) reads the
    //    Redis client at import time, so the mock must exist first.
    await jest.unstable_mockModule('../src/infra/redis/connection.js', () =>
      redisMock(redisStore)
    );

    // 3. Dynamically import application modules AFTER mocks are registered.
    const appModule = await import('../src/app.js');
    const blocklistModule = await import('../src/infra/redis/tokenBlocklist.js');
    const sseAuthModule = await import('../src/shared/middleware/requireSseAuth.js');
    const sseHubModule = await import('../src/infra/sse/sseHub.js');
    const factoriesModule = await import('./fixtures/factories.js');

    app = appModule.buildApp();
    blockToken = blocklistModule.blockToken as unknown as BlockToken;
    requireSseAuth = sseAuthModule.requireSseAuth as unknown as RequireSseAuth;
    deliverToUserForTest = sseHubModule.deliverToUserForTest as unknown as DeliverToUserForTest;
    getSseClientCount = sseHubModule.getSseClientCount as unknown as GetSseClientCount;
    registerSseClient = sseHubModule.registerSseClient as unknown as RegisterSseClient;
    resetSseHubForTest = sseHubModule.resetSseHubForTest as unknown as ResetSseHubForTest;
    signJwt = factoriesModule.signToken as unknown as SignToken;

    resetSseHubForTest();
  });

  afterEach(() => {
    jest.useRealTimers();
    resetSseHubForTest?.();
  });

  afterAll(() => {
    redisStore.clear();
  });

  // ── Helper (local) ─────────────────────────────────────────────────────────

  function signToken(overrides: Record<string, unknown> = {}): string {
    return signJwt(
      { userId: 'user-123', role: 'ADMIN', organizationId: 'org-456', jti: VALID_JTI, ...overrides }
    );
  }

  // ── Authentication ─────────────────────────────────────────────────────────

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

    /**
     * #764 — This test now works because the Redis mock is registered BEFORE
     *         requireSseAuth is imported (inside beforeEach), so blockToken
     *         writes to the same in-memory store that isTokenBlocked reads.
     *
     * #765 — Assertion updated: the standard error envelope exposes the code
     *         at `res.body.error.code`, not `res.body.code`.  The value is
     *         `'ERR_AUTH_TOKEN_REVOKED'` (ErrorCodes.TOKEN_REVOKED), not the
     *         raw enum key 'TOKEN_REVOKED'.
     */
    it('returns 401 when token is revoked', async () => {
      // Write the revoked JTI to the in-memory Redis store via the blocklist helper.
      await blockToken(REVOKED_JTI, 3600);

      const token = signToken({ jti: REVOKED_JTI });
      const res = await request(app)
        .get('/api/events')
        .set('Authorization', `Bearer ${token}`);

      // HTTP status
      expect(res.status).toBe(401);

      // Envelope shape (success: false, data: null)
      expect(res.body.success).toBe(false);
      expect(res.body.data).toBeNull();

      // #765: code lives at error.code, not top-level code.
      // Value is 'ERR_AUTH_TOKEN_REVOKED', not 'TOKEN_REVOKED'.
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe('ERR_AUTH_TOKEN_REVOKED');
    });

    it('accepts JWT via Authorization header', async () => {
      const token = signToken();
      const req = {
        headers: { authorization: `Bearer ${token}` },
        query: {},
      } as unknown as Request;

      const next = jest.fn() as jest.MockedFunction<NextFunction>;
      await requireSseAuth(req, {} as Response, next);

      expect(next).toHaveBeenCalledWith();
      expect((req as Request & { user?: { userId: string } }).user?.userId).toBe('user-123');
    });

    it('accepts JWT via ?token= query parameter', async () => {
      const token = signToken();
      const req = {
        headers: {},
        query: { token },
      } as unknown as Request;

      const next = jest.fn() as jest.MockedFunction<NextFunction>;
      await requireSseAuth(req, {} as Response, next);

      expect(next).toHaveBeenCalledWith();
      expect((req as Request & { user?: { userId: string } }).user?.userId).toBe('user-123');
    });
  });

  // ── SSE stream behaviour ───────────────────────────────────────────────────

  describe('SSE stream behavior', () => {
    it('sets text/event-stream headers and sends connected comment', () => {
      const res = createMockResponse();
      registerSseClient('user-123', res);

      expect(res.writeHead).toHaveBeenCalledWith(
        200,
        expect.objectContaining({
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        })
      );
      expect((res as unknown as { chunks: string[] }).chunks.join('')).toContain(': connected');
      expect(getSseClientCount('user-123')).toBe(1);
    });

    it('delivers typed events to connected clients', () => {
      const res = createMockResponse();
      registerSseClient('user-123', res);

      const event: RealtimeEvent = {
        type: 'shipment:status',
        shipmentId: 'ship-1',
        newStatus: 'IN_TRANSIT',
        timestamp: '2026-01-15T12:00:00.000Z',
      };

      deliverToUserForTest('user-123', event);

      const output = (res as unknown as { chunks: string[] }).chunks.join('');
      expect(output).toContain('event: shipment:status');
      expect(output).toContain('"newStatus":"IN_TRANSIT"');
    });

    it('sends heartbeat comments every 30 seconds', () => {
      jest.useFakeTimers();
      const res = createMockResponse();
      registerSseClient('user-123', res);

      const initialChunks = (res as unknown as { chunks: string[] }).chunks.length;
      jest.advanceTimersByTime(30_000);

      expect((res as unknown as { chunks: string[] }).chunks.length).toBeGreaterThan(initialChunks);
      expect((res as unknown as { chunks: string[] }).chunks.at(-1)).toBe(': heartbeat\n\n');
    });

    it('removes client on close', () => {
      const res = createMockResponse();
      registerSseClient('user-123', res);
      expect(getSseClientCount('user-123')).toBe(1);

      res.emit('close');
      expect(getSseClientCount('user-123')).toBe(0);
    });
  });
});
