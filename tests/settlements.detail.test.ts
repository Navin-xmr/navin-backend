/**
 * Tests for #375: GET /api/settlements/:id and POST /api/settlements/:id/dispute
 *
 * Covers:
 *   - 200 detail (happy path)
 *   - 200 dispute (happy path)
 *   - 403 VIEWER cannot dispute
 *   - 404 missing settlement
 */
import { jest, describe, it, beforeEach, expect } from '@jest/globals';
import type { Request, Response } from 'express';
import { createStellarServiceMock } from './helpers/mocks.js';

// ── Repo mock ────────────────────────────────────────────────────────────────
const getPaymentByIdMock = jest.fn<(id: string) => Promise<unknown>>();
const disputePaymentMock = jest.fn<(id: string, reason: string, notes?: string) => Promise<unknown>>();

await jest.unstable_mockModule('../src/modules/payments/payments.repo.js', () => ({
  getPaymentsByOrganization: jest.fn(),
  getPaymentById: getPaymentByIdMock,
  createPayment: jest.fn(),
  updatePaymentStatus: jest.fn(),
  getPaymentByShipmentId: jest.fn(),
  deletePayment: jest.fn(),
  aggregateSettlementSummary: jest.fn(),
  buildSettlementSparkline: jest.fn(),
  disputePayment: disputePaymentMock,
}));

await jest.unstable_mockModule('../src/services/stellar.service.js', () =>
  createStellarServiceMock()
);

await jest.unstable_mockModule('../src/infra/socket/io.js', () => ({
  emitPaymentStatusChange: jest.fn(),
  getIO: jest.fn(),
  initSocketIO: jest.fn(),
  closeSocketIO: jest.fn(async () => undefined),
  getActiveUsers: jest.fn(() => new Map()),
  emitAnomalyDetected: jest.fn(),
  emitTelemetryUpdate: jest.fn(),
  emitStatusUpdate: jest.fn(),
}));

const { getPaymentByIdService, disputeSettlementService } = await import(
  '../src/modules/payments/payments.service.js'
);
const {
  getSettlementByIdController,
  disputeSettlementController,
} = await import('../src/modules/payments/payments.controller.js');

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeSettlement(overrides: Record<string, unknown> = {}) {
  return {
    _id: '507f1f77bcf86cd799439011',
    shipmentId: '507f1f77bcf86cd799439012',
    organizationId: '507f1f77bcf86cd799439013',
    amount: 500,
    token: 'USDC',
    tokenType: 'USDC',
    status: 'Escrowed',
    payerAddress: 'G-PAYER',
    payeeAddress: 'G-PAYEE',
    stellarTxHash: undefined,
    escrowRelease: undefined,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeReq(params: Record<string, string> = {}, body: Record<string, unknown> = {}, role = 'ADMIN') {
  return {
    params,
    body,
    user: { organizationId: 'org-123', userId: 'user-1', role },
  } as unknown as Request;
}

function makeRes() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return { res: { status, json } as unknown as Response, status, json };
}

// ── getPaymentByIdService ─────────────────────────────────────────────────────

describe('getPaymentByIdService', () => {
  beforeEach(() => {
    getPaymentByIdMock.mockReset();
  });

  it('returns full settlement detail when found', async () => {
    const settlement = makeSettlement();
    getPaymentByIdMock.mockResolvedValue(settlement);

    const result = await getPaymentByIdService('507f1f77bcf86cd799439011');

    expect(result).toMatchObject({
      _id: '507f1f77bcf86cd799439011',
      amount: 500,
      token: 'USDC',
      payerAddress: 'G-PAYER',
      payeeAddress: 'G-PAYEE',
    });
  });

  it('throws 404 when settlement not found', async () => {
    getPaymentByIdMock.mockResolvedValue(null);

    await expect(getPaymentByIdService('does-not-exist')).rejects.toMatchObject({
      statusCode: 404,
      code: 'ERR_PAYMENT_NOT_FOUND',
    });
  });
});

// ── disputeSettlementService ──────────────────────────────────────────────────

describe('disputeSettlementService', () => {
  beforeEach(() => {
    getPaymentByIdMock.mockReset();
    disputePaymentMock.mockReset();
  });

  it('transitions status to DISPUTED and populates escrowRelease metadata', async () => {
    const original = makeSettlement({ status: 'Escrowed' });
    const updated = makeSettlement({
      status: 'Disputed',
      escrowRelease: {
        disputedAt: new Date('2024-01-02T00:00:00Z'),
        disputeReason: 'goods not delivered',
        additionalNotes: 'see invoice #42',
      },
    });

    getPaymentByIdMock.mockResolvedValue(original);
    disputePaymentMock.mockResolvedValue(updated);

    const result = await disputeSettlementService('507f1f77bcf86cd799439011', {
      reason: 'goods not delivered',
      notes: 'see invoice #42',
    });

    expect(disputePaymentMock).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439011',
      'goods not delivered',
      'see invoice #42'
    );
    expect(result).toMatchObject({
      status: 'Disputed',
      escrowRelease: expect.objectContaining({
        disputeReason: 'goods not delivered',
      }),
    });
  });

  it('throws 404 when settlement not found', async () => {
    getPaymentByIdMock.mockResolvedValue(null);

    await expect(
      disputeSettlementService('no-such-id', { reason: 'test' })
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'ERR_PAYMENT_NOT_FOUND',
    });
  });
});

// ── Controller: getSettlementByIdController ───────────────────────────────────

describe('getSettlementByIdController', () => {
  beforeEach(() => {
    getPaymentByIdMock.mockReset();
  });

  it('200 — returns full detail including escrowRelease', async () => {
    const settlement = makeSettlement({
      escrowRelease: { conditionDescription: 'delivered', releasedAt: new Date() },
    });
    getPaymentByIdMock.mockResolvedValue(settlement);

    const req = makeReq({ id: settlement._id as string });
    const { res, status, json } = makeRes();

    await getSettlementByIdController(req, res, jest.fn() as never);

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          _id: settlement._id,
          escrowRelease: expect.objectContaining({ conditionDescription: 'delivered' }),
        }),
      })
    );
  });

  it('propagates 404 AppError to next when settlement missing', async () => {
    getPaymentByIdMock.mockResolvedValue(null);

    const req = makeReq({ id: 'missing-id' });
    const { res } = makeRes();
    const next = jest.fn();

    await getSettlementByIdController(req, res, next as never);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404, code: 'ERR_PAYMENT_NOT_FOUND' })
    );
  });
});

// ── Controller: disputeSettlementController ───────────────────────────────────

describe('disputeSettlementController', () => {
  beforeEach(() => {
    getPaymentByIdMock.mockReset();
    disputePaymentMock.mockReset();
  });

  it('200 — ADMIN can dispute a settlement', async () => {
    const original = makeSettlement({ status: 'Escrowed' });
    const updated = makeSettlement({
      status: 'Disputed',
      escrowRelease: { disputedAt: new Date(), disputeReason: 'damaged goods' },
    });

    getPaymentByIdMock.mockResolvedValue(original);
    disputePaymentMock.mockResolvedValue(updated);

    const req = makeReq({ id: original._id as string }, { reason: 'damaged goods' }, 'ADMIN');
    const { res, status, json } = makeRes();

    await disputeSettlementController(req, res, jest.fn() as never);

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ status: 'Disputed' }),
      })
    );
  });

  it('200 — MANAGER can also dispute a settlement', async () => {
    const original = makeSettlement({ status: 'Escrowed' });
    const updated = makeSettlement({ status: 'Disputed' });

    getPaymentByIdMock.mockResolvedValue(original);
    disputePaymentMock.mockResolvedValue(updated);

    const req = makeReq({ id: original._id as string }, { reason: 'missing item' }, 'MANAGER');
    const { res, status } = makeRes();

    await disputeSettlementController(req, res, jest.fn() as never);

    expect(status).toHaveBeenCalledWith(200);
  });

  it('propagates 404 to next when settlement is missing', async () => {
    getPaymentByIdMock.mockResolvedValue(null);

    const req = makeReq({ id: 'nonexistent' }, { reason: 'test' }, 'ADMIN');
    const { res } = makeRes();
    const next = jest.fn();

    await disputeSettlementController(req, res, next as never);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404 })
    );
  });
});

// ── Route-level 403 for VIEWER (requires requireRole middleware — tested via mock) ──

describe('requireRole VIEWER cannot dispute', () => {
  it('VIEWER role triggers 403 from requireRole middleware', async () => {
    // requireRole is an express middleware; simulate it inline
    const { requireRole } = await import('../src/shared/middleware/requireRole.js');
    const middleware = requireRole('ADMIN', 'MANAGER');

    const req = {
      user: { role: 'VIEWER', userId: 'v1', organizationId: 'org-1' },
    } as unknown as Request;
    const { res } = makeRes();
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403, code: 'ERR_PERMISSION_DENIED' })
    );
  });
});
