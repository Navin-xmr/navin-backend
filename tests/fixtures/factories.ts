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
import { UserRole } from '../../src/shared/constants/index.js';
import { ShipmentStatus } from '../../src/shared/types/shipment.js';
import { PaymentStatus } from '../../src/modules/payments/payments.model.js';
import { InvitationStatus } from '../../src/modules/invitations/invitations.model.js';
import type { IUser } from '../../src/shared/types/user.js';
import type { IOrganization } from '../../src/shared/types/user.js';
import type { IShipment } from '../../src/shared/types/shipment.js';
import type { IPayment } from '../../src/modules/payments/payments.model.js';
import type { IInvitation } from '../../src/modules/invitations/invitations.model.js';
import type { ILedgerBlock } from '../../src/modules/ledger/ledger.model.js';

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
