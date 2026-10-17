/**
 * Reusable ESM mock factories for Jest `unstable_mockModule`.
 *
 * ## ESM-safe pattern (required)
 *
 * ```ts
 * import { jest } from '@jest/globals';
 *
 * jest.resetModules();
 * await jest.unstable_mockModule('../src/services/stellar.service.js', () =>
 *   createStellarServiceMock()
 * );
 * // Import the module under test *after* registering mocks
 * const mod = await import('../src/services/stellar.service.js');
 * ```
 *
 * Order matters: reset → mock → import. Factories return complete shapes so
 * callers never omit a named export. Keep provider boundaries fully mocked;
 * importing the real module to discover exports can initialize external clients.
 */
import { jest } from '@jest/globals';
import { UserRole } from '../../src/shared/constants/index.js';
import { OrganizationType } from '../../src/shared/types/user.js';
import type * as usersRepo from '../../src/modules/users/users.repo.js';
import type { sendEmail } from '../../src/services/email.service.js';
import type * as emailService from '../../src/services/email.service.js';
import type * as socketIo from '../../src/infra/socket/io.js';
import { fakeQuery } from './fakeModel.js';
import type { FakeQuery } from './fakeModel.js';

type MockFn = ReturnType<typeof jest.fn>;

/** Script a query result usable both with direct await and with repository chains. */
export function createModelQuery<T>(value: T): FakeQuery<T> {
  return fakeQuery(value);
}

export type UsersRepoMock = jest.Mocked<typeof usersRepo>;

/** Complete repository boundary; tests explicitly arrange every exercised operation. */
export function createUsersRepoMock(overrides: Partial<UsersRepoMock> = {}): UsersRepoMock {
  return {
    createUser: jest.fn<typeof usersRepo.createUser>(),
    findUserByEmail: jest.fn<typeof usersRepo.findUserByEmail>(),
    findUserById: jest.fn<typeof usersRepo.findUserById>(),
    findUsersByOrganizationId: jest.fn<typeof usersRepo.findUsersByOrganizationId>(),
    ...overrides,
  };
}

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
    findOneAndUpdate: MockFn;
    updateOne: MockFn;
    updateMany: MockFn;
    deleteOne: MockFn;
    countDocuments: MockFn;
  };
  OrganizationModel: {
    findById: MockFn;
    findOne: MockFn;
    find: MockFn;
    findByIdAndUpdate: MockFn;
    create: MockFn;
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

export type SocketIoMock = { [K in keyof typeof socketIo]: MockFn };

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
    getStellarExplorerUrl: (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`,
    ...overrides,
  };
}

import { AppError, ErrorCodes } from '../../src/shared/http/errors.js';
import type { ChainEvent } from '../../src/shared/types/chain.js';
import type { AnchorResult, EscrowResult } from '../../src/services/chain/types.js';

export type ChainAdapterMock = {
  anchorEvent: MockFn;
  releaseEscrow: MockFn;
  streamEvents: MockFn;
};

export interface ChainAdapterMockOptions {
  events?: readonly ChainEvent[];
  malformedEvents?: readonly unknown[];
  anchorResult?: Partial<AnchorResult>;
  releaseResult?: Partial<EscrowResult>;
  anchorFailures?: number;
  releaseFailures?: number;
}

export type ChainFactoryMock = {
  createChainAdapter: MockFn;
  getChainAdapter: MockFn;
  resetChainAdapter: MockFn;
  getChainActorAddress: MockFn;
};

const MOCK_TX_HASH = 'a'.repeat(64);

/**
 * Port-shaped adapter: anchors/releases resolve a simulated receipt, the event
 * stream yields injected events (or is empty by default). Supports scriptable
 * results, transient failure counts, and per-method overrides.
 */
export function createChainAdapterMock(
  overrides: Partial<ChainAdapterMock> = {},
  options: ChainAdapterMockOptions = {}
): ChainAdapterMock {
  let anchorFailures = options.anchorFailures ?? 0;
  let releaseFailures = options.releaseFailures ?? 0;

  return {
    anchorEvent: jest.fn(async () => {
      if (anchorFailures > 0) {
        anchorFailures -= 1;
        throw new AppError(502, 'Mock anchor failure', ErrorCodes.CHAIN_UNKNOWN);
      }
      return {
        txHash: MOCK_TX_HASH,
        ledger: 1,
        simulated: true,
        ...options.anchorResult,
      };
    }),
    releaseEscrow: jest.fn(async (input: unknown) => {
      if (releaseFailures > 0) {
        releaseFailures -= 1;
        throw new AppError(502, 'Mock escrow failure', ErrorCodes.CHAIN_UNKNOWN);
      }
      return {
        txHash: MOCK_TX_HASH,
        ledger: 1,
        simulated: true,
        paymentId: (input as { payment_id: string }).payment_id,
        ...options.releaseResult,
      };
    }),
    streamEvents: jest.fn(async function* (cursor?: unknown) {
      let pastCursor = cursor === undefined;
      for (const event of [...(options.events ?? []), ...(options.malformedEvents ?? [])]) {
        const candidate = event as ChainEvent;
        if (!pastCursor) {
          if (candidate.id === cursor) pastCursor = true;
          continue;
        }
        yield candidate;
      }
    }),
    ...overrides,
  };
}

/**
 * Full mock of `src/services/chain/factory.js` named exports.
 * `getChainAdapter()` / `createChainAdapter()` return `adapter`.
 */
export function createChainFactoryMock(
  adapter: ChainAdapterMock = createChainAdapterMock(),
  overrides: Partial<ChainFactoryMock> = {}
): ChainFactoryMock {
  return {
    createChainAdapter: jest.fn(() => adapter),
    getChainAdapter: jest.fn(() => adapter),
    resetChainAdapter: jest.fn(),
    getChainActorAddress: jest.fn(() => 'GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H'),
    ...overrides,
  };
}

/**
 * Full mock of `src/modules/users/users.model.js` named exports.
 */
export function createUsersModelMock(
  overrides: {
    UserModel?: Partial<UsersModelMock['UserModel']>;
    OrganizationModel?: Partial<UsersModelMock['OrganizationModel']>;
    UserRole?: UsersModelMock['UserRole'];
    OrganizationType?: UsersModelMock['OrganizationType'];
  } = {}
): UsersModelMock {
  return {
    UserModel: {
      create: jest.fn(),
      find: jest.fn(() => createModelQuery([])),
      findOne: jest.fn(() => createModelQuery(null)),
      findById: jest.fn(() => createModelQuery(null)),
      findByIdAndUpdate: jest.fn(() => createModelQuery(null)),
      findOneAndUpdate: jest.fn(),
      updateOne: jest.fn(),
      updateMany: jest.fn(),
      deleteOne: jest.fn(),
      countDocuments: jest.fn(async () => 0),
      ...(overrides.UserModel ?? {}),
    },
    OrganizationModel: {
      findById: jest.fn(() => createModelQuery(null)),
      findOne: jest.fn(() => createModelQuery(null)),
      find: jest.fn(() => createModelQuery([])),
      findByIdAndUpdate: jest.fn(() => createModelQuery(null)),
      create: jest.fn(),
      ...(overrides.OrganizationModel ?? {}),
    },
    UserRole: {
      ...UserRole,
      ...(overrides.UserRole ?? {}),
    },
    OrganizationType: {
      ...OrganizationType,
      ...(overrides.OrganizationType ?? {}),
    },
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
      updateOne: jest.fn(),
      deleteMany: jest.fn(),
      updateMany: jest.fn(),
      ...(overrides.Telemetry ?? {}),
    },
    TelemetryAnchorStatus: {
      PENDING_ANCHOR: 'PENDING_ANCHOR',
      ANCHORED: 'ANCHORED',
      ANCHOR_FAILED: 'ANCHOR_FAILED',
      VERIFIED: 'VERIFIED',
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
    emitPaymentStatusChange: jest.fn(),
    emitNotificationNew: jest.fn(),
    ...overrides,
  };
}

export type EmailServiceMock = Omit<typeof emailService, 'sendEmail'> & {
  sendEmail: jest.Mock<typeof sendEmail>;
};

/**
 * Full mock of `src/services/email.service.js` named exports.
 */
export function createEmailServiceMock(
  overrides: Partial<EmailServiceMock> = {}
): EmailServiceMock {
  return {
    sendEmail: jest.fn<typeof sendEmail>().mockResolvedValue(undefined),
    resetPasswordEmailHtml: (link: string) => `<html>Reset: ${link}</html>`,
    invitationEmailHtml: (link: string) => `<html>Invite: ${link}</html>`,
    ...overrides,
  };
}
