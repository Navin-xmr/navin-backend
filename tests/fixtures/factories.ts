/**
 * Typed test factories for creating consistent mock data across the test suite.
 *
 * ## Usage
 *
 * ```ts
 * import { createMockUser, createMockShipment } from '../fixtures/factories.js';
 *
 * const user = createMockUser({ role: UserRole.ADMIN });
 * const shipment = createMockShipment({ enterpriseId: user.organizationId });
 * ```
 *
 * Each factory returns a **plain object** (never a Mongoose Document) so tests
 * can assert exact shapes without `.toObject()` noise. All factories accept a
 * `Partial<T>` override object so individual tests can tweak only the fields
 * they care about.
 */

import { Types } from 'mongoose';
import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import { UserRole } from '../../src/shared/constants/index.js';
import { ShipmentStatus } from '../../src/shared/types/shipment.js';
import { PaymentStatus } from '../../src/modules/payments/payments.model.js';
import { InvitationStatus } from '../../src/modules/invitations/invitations.model.js';
import { TelemetryAnchorStatus } from '../../src/shared/types/telemetry.js';
import type { IUser } from '../../src/shared/types/user.js';
import type { IOrganization } from '../../src/shared/types/user.js';
import type { IShipment } from '../../src/shared/types/shipment.js';
import type { IPayment } from '../../src/modules/payments/payments.model.js';
import type { IInvitation } from '../../src/modules/invitations/invitations.model.js';
import type { ILedgerBlock } from '../../src/modules/ledger/ledger.model.js';
import type { ITelemetry } from '../../src/shared/types/telemetry.js';

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export function createMockUser(overrides: Partial<IUser> = {}): IUser {
  const id = new Types.ObjectId().toString();
  return {
    _id: id,
    email: `user-${id.slice(-6)}@example.com`,
    name: 'Test User',
    passwordHash: 'hashed-password-placeholder',
    role: UserRole.VIEWER,
    organizationId: new Types.ObjectId().toString(),
    walletAddress: undefined,
    phone: undefined,
    phoneVerified: false,
    deletedAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

export function createMockOrganization(
  overrides: Partial<IOrganization> = {}
): IOrganization {
  const id = new Types.ObjectId().toString();
  return {
    _id: id,
    name: `Test Org ${id.slice(-6)}`,
    type: 'ENTERPRISE',
    settings: {},
    deletedAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Shipments
// ---------------------------------------------------------------------------

export function createMockShipment(overrides: Partial<IShipment> = {}): IShipment {
  const id = new Types.ObjectId().toString();
  const now = new Date().toISOString();
  return {
    _id: id,
    trackingNumber: `TRK-${id.slice(-8)}`,
    origin: 'Lagos',
    destination: 'Abuja',
    enterpriseId: new Types.ObjectId().toString(),
    logisticsId: new Types.ObjectId().toString(),
    status: ShipmentStatus.CREATED,
    priority: 'STANDARD',
    expectedDelivery: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    milestones: [],
    offChainMetadata: {},
    documents: [],
    photos: [],
    disputes: [],
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export function createMockPayment(overrides: Partial<IPayment> = {}): IPayment {
  const id = new Types.ObjectId().toString();
  const now = new Date();
  return {
    _id: id,
    shipmentId: new Types.ObjectId(),
    organizationId: new Types.ObjectId(),
    amount: 1000,
    tokenType: 'USDC',
    token: 'USDC',
    payerAddress: 'GABC123...',
    payeeAddress: 'GDEF456...',
    status: PaymentStatus.PENDING,
    stellarTxHash: undefined,
    escrowRelease: undefined,
    createdAt: now,
    updatedAt: now,
    deletedAt: undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

export function createMockInvitation(overrides: Partial<IInvitation> = {}): IInvitation {
  const id = new Types.ObjectId().toString();
  const now = new Date();
  const expiry = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  return {
    _id: id,
    email: `invite-${id.slice(-6)}@example.com`,
    role: UserRole.VIEWER,
    status: InvitationStatus.PENDING,
    tokenHash: `hash-${id.slice(-8)}`,
    expiresAt: expiry,
    message: undefined,
    invitedBy: new Types.ObjectId().toString(),
    organizationId: new Types.ObjectId().toString(),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Ledger Blocks
// ---------------------------------------------------------------------------

export function createMockLedgerBlock(overrides: Partial<ILedgerBlock> = {}): ILedgerBlock {
  const id = new Types.ObjectId().toString();
  const now = new Date();
  return {
    _id: id,
    shipmentId: new Types.ObjectId().toString(),
    eventType: 'PICKED_UP',
    milestoneEvent: 'PICKED_UP',
    stellarTxHash: `tx-${id.slice(-8)}`,
    metadata: {},
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

export function createMockTelemetry(overrides: Partial<ITelemetry> = {}): ITelemetry {
  const id = new Types.ObjectId().toString();
  const now = new Date();
  return {
    _id: id,
    sensorId: `sensor-${id.slice(-6)}`,
    shipmentId: new Types.ObjectId().toString(),
    temperature: 20.5,
    humidity: 50,
    latitude: 6.5244,
    longitude: 3.3792,
    batteryLevel: 95,
    timestamp: now,
    dataHash: 'test-data-hash',
    stellarTxHash: `tx-${id.slice(-8)}`,
    anchorStatus: TelemetryAnchorStatus.ANCHORED,
    rawPayload: {},
    verified: false,
    confirmationMetadata: undefined,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Auth tokens
// ---------------------------------------------------------------------------

const TEST_JWT_SECRET = 'test-jwt-secret-key-at-least-32-chars-long!';

/** Signs `claims` with the test JWT secret (see `tests/setup.ts`). No default claims are injected. */
export function signToken(claims: Record<string, unknown> = {}, options: SignOptions = {}): string {
  return jwt.sign(claims, process.env.JWT_SECRET ?? TEST_JWT_SECRET, options);
}

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------

export function multerFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'proof.jpg',
    encoding: '7bit',
    mimetype: 'image/jpeg',
    size: 123,
    buffer: Buffer.from('fake'),
    destination: '',
    filename: 'proof.jpg',
    path: '',
    stream: null as unknown as Express.Multer.File['stream'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Payment documents (lean/plain shape as returned by services)
// ---------------------------------------------------------------------------

export function paymentDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: '507f1f77bcf86cd799439011',
    shipmentId: '507f1f77bcf86cd799439012',
    organizationId: '507f1f77bcf86cd799439013',
    amount: 100,
    tokenType: 'USDC',
    status: 'Pending',
    stellarTxHash: undefined,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Redis
// ---------------------------------------------------------------------------

/**
 * In-memory mock of `src/infra/redis/connection.js` backed by `store`.
 * Register via `jest.unstable_mockModule('../src/infra/redis/connection.js', () => redisMock(store))`.
 */
export function redisMock(store: Map<string, string> = new Map()) {
  const lists = new Map<string, string[]>();
  const expirations = new Map<string, number>();
  const isExpired = (key: string): boolean => {
    const at = expirations.get(key);
    if (at !== undefined && Date.now() >= at) {
      store.delete(key);
      expirations.delete(key);
      return true;
    }
    return false;
  };
  const client = {
    get: async (key: string) => (isExpired(key) ? null : (store.get(key) ?? null)),
    set: async (key: string, value: string, ...args: unknown[]) => {
      store.set(key, value);
      for (let i = 0; i < args.length; i += 1) {
        if ((args[i] === 'EX' || args[i] === 'ex') && typeof args[i + 1] === 'number') {
          expirations.set(key, Date.now() + (args[i + 1] as number) * 1000);
        }
      }
      return 'OK';
    },
    setex: async (key: string, seconds: number, value: string) => {
      store.set(key, value);
      expirations.set(key, Date.now() + seconds * 1000);
      return 'OK';
    },
    del: async (...keys: string[]) => {
      let removed = 0;
      for (const key of keys.flat()) {
        if (store.delete(key)) removed += 1;
        expirations.delete(key);
        if (lists.delete(key)) removed += 1;
      }
      return removed;
    },
    exists: async (...keys: string[]) => {
      let count = 0;
      for (const key of keys.flat()) {
        if (!isExpired(key) && store.has(key)) count += 1;
      }
      return count;
    },
    ttl: async (key: string) => {
      if (!store.has(key) || isExpired(key)) return -2;
      const at = expirations.get(key);
      if (at === undefined) return -1;
      return Math.max(0, Math.ceil((at - Date.now()) / 1000));
    },
    expire: async (key: string, seconds: number) => {
      if (!store.has(key)) return 0;
      expirations.set(key, Date.now() + seconds * 1000);
      return 1;
    },
    pttl: async (key: string) => {
      if (!store.has(key) || isExpired(key)) return -2;
      const at = expirations.get(key);
      if (at === undefined) return -1;
      return Math.max(0, at - Date.now());
    },
    incr: async (key: string) => {
      const next = (Number(store.get(key) ?? '0') || 0) + 1;
      store.set(key, String(next));
      return next;
    },
    decr: async (key: string) => {
      const next = (Number(store.get(key) ?? '0') || 0) - 1;
      store.set(key, String(next));
      return next;
    },
    scan: async (): Promise<[string, string[]]> => ['0', [...store.keys()]],
    lpush: async (key: string, ...values: string[]) => {
      const list = lists.get(key) ?? [];
      list.unshift(...values.reverse());
      lists.set(key, list);
      return list.length;
    },
    ltrim: async () => 'OK' as const,
    lindex: async () => null,
    rpop: async () => null,
    lrange: async () => [] as string[],
    publish: async () => 0,
    subscribe: async () => 0,
    unsubscribe: async () => 0,
    pipeline: () => ({ lpush: () => undefined, ltrim: () => undefined, exec: async () => [] as Array<[null, unknown]> }),
    duplicate: () => client,
    on: () => client,
    removeAllListeners: () => client,
    quit: async () => 'OK' as const,
    disconnect: () => undefined,
    options: { host: 'localhost', port: 6379 },
  };
  return {
    getRedisClient: () => client,
    getRedisConnection: () => client,
    getBullMQConnection: () => ({ host: 'localhost', port: 6379 }),
    disconnectRedis: async () => undefined,
    isRedisInitialized: () => true,
    resetInMemoryRedisForTest: () => {
      store.clear();
      lists.clear();
      expirations.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// Persisted seeds (require an active Mongo connection)
// ---------------------------------------------------------------------------

export async function seedOrg(overrides: Record<string, unknown> = {}) {
  // Lazy import so suites that mock users.model can still import this file.
  const { OrganizationModel } = await import('../../src/modules/users/users.model.js');
  return OrganizationModel.create({ name: 'Test Org', type: 'ENTERPRISE', ...overrides });
}

// ---------------------------------------------------------------------------
// Invitation service arguments
// ---------------------------------------------------------------------------

export function invitationArgs<T extends Record<string, unknown>>(overrides: T = {} as T) {
  return {
    email: 'user@test.com',
    role: 'VIEWER',
    inviterId: 'user-1',
    inviterRole: 'ADMIN',
    organizationId: 'org-1',
    ...overrides,
  };
}
