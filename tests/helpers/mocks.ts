/**
 * Reusable ESM mock factories for Jest `unstable_mockModule`.
 *
 * ## ESM mocking pattern
 *
 * Jest hoists `jest.mock()` calls, but native ESM modules require
 * `jest.unstable_mockModule()` which is **not** hoisted. The typical pattern:
 *
 * ```ts
 * import { jest } from '@jest/globals';
 * import { createStellarServiceMock } from './helpers/mocks.js';
 *
 * await jest.unstable_mockModule('../src/services/stellar.service.js', () =>
 *   createStellarServiceMock()
 * );
 *
 * // Import the module under test *after* registering mocks
 * const { tokenizeShipment } = await import('../src/services/stellar.service.js');
 * ```
 *
 * Each factory returns a complete module shape so callers never omit a named
 * export that downstream code may import.
 */
import { jest } from '@jest/globals';

type MockFn = ReturnType<typeof jest.fn>;

export type StellarServiceMock = {
  tokenizeShipment: MockFn;
  anchorTelemetryHash: MockFn;
  releaseEscrow: MockFn;
  getStellarExplorerUrl: (txHash: string) => string;
};

export type UsersModelMock = {
  UserModel: {
    create: MockFn;
    find: MockFn;
    findOne: MockFn;
    findById: MockFn;
    findByIdAndUpdate: MockFn;
  };
  OrganizationModel: {
    findById: MockFn;
  };
  UserRole: Record<string, string>;
  OrganizationType: Record<string, string>;
};

export type TelemetryModelMock = {
  Telemetry: {
    create: MockFn;
    find: MockFn;
    findOne: MockFn;
    findByIdAndUpdate: MockFn;
    deleteMany: MockFn;
    updateMany: MockFn;
  };
  TelemetryAnchorStatus: Record<string, string>;
};

export type SocketIoMock = {
  getActiveUsers: MockFn;
  initSocketIO: MockFn;
  getIO: MockFn;
  closeSocketIO: MockFn;
  emitAnomalyDetected: MockFn;
  emitTelemetryUpdate: MockFn;
  emitStatusUpdate: MockFn;
};

/**
 * Full mock of `src/services/stellar.service.js` named exports.
 */
export function createStellarServiceMock(
  overrides: Partial<StellarServiceMock> = {}
): StellarServiceMock {
  return {
    tokenizeShipment: jest.fn(),
    anchorTelemetryHash: jest.fn(),
    releaseEscrow: jest.fn(),
    getStellarExplorerUrl: (hash: string) =>
      `https://stellar.expert/explorer/testnet/tx/${hash}`,
    ...overrides,
  };
}

/**
 * Full mock of `src/modules/users/users.model.js` named exports.
 */
export function createUsersModelMock(overrides: Partial<UsersModelMock> = {}): UsersModelMock {
  return {
    UserModel: {
      create: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      ...(overrides.UserModel ?? {}),
    },
    OrganizationModel: {
      findById: jest.fn(),
      ...(overrides.OrganizationModel ?? {}),
    },
    UserRole: {
      SUPER_ADMIN: 'SUPER_ADMIN',
      ADMIN: 'ADMIN',
      MANAGER: 'MANAGER',
      VIEWER: 'VIEWER',
      CUSTOMER: 'CUSTOMER',
      ...(overrides.UserRole ?? {}),
    },
    OrganizationType: {
      ENTERPRISE: 'ENTERPRISE',
      LOGISTICS: 'LOGISTICS',
      ...(overrides.OrganizationType ?? {}),
    },
    ...overrides,
  };
}

/**
 * Full mock of `src/modules/telemetry/telemetry.model.js` named exports.
 */
export function createTelemetryModelMock(
  overrides: Partial<TelemetryModelMock> = {}
): TelemetryModelMock {
  return {
    Telemetry: {
      create: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      deleteMany: jest.fn(),
      updateMany: jest.fn(),
      ...(overrides.Telemetry ?? {}),
    },
    TelemetryAnchorStatus: {
      PENDING_ANCHOR: 'PENDING_ANCHOR',
      ANCHORED: 'ANCHORED',
      ANCHOR_FAILED: 'ANCHOR_FAILED',
      ...(overrides.TelemetryAnchorStatus ?? {}),
    },
    ...overrides,
  };
}

/**
 * Full mock of `src/infra/socket/io.js` named exports.
 */
export function createSocketIoMock(overrides: Partial<SocketIoMock> = {}): SocketIoMock {
  return {
    getActiveUsers: jest.fn(() => new Map()),
    initSocketIO: jest.fn(),
    getIO: jest.fn(),
    closeSocketIO: jest.fn(async () => undefined),
    emitAnomalyDetected: jest.fn(),
    emitTelemetryUpdate: jest.fn(),
    emitStatusUpdate: jest.fn(),
    ...overrides,
  };
}
