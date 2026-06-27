import { jest, describe, it, beforeEach, expect } from '@jest/globals';
import type { Request, Response } from 'express';

// ── Repo mock ────────────────────────────────────────────────────────────────
const getPaymentsByOrganizationMock =
  jest.fn<(orgId: string, filters?: unknown) => Promise<unknown>>();
const getPaymentByIdMock = jest.fn<(id: string) => Promise<unknown>>();

await jest.unstable_mockModule('../src/modules/payments/payments.repo.js', () => ({
  getPaymentsByOrganization: getPaymentsByOrganizationMock,
  getPaymentById: getPaymentByIdMock,
  createPayment: jest.fn(),
  updatePaymentStatus: jest.fn(),
  getPaymentByShipmentId: jest.fn(),
  deletePayment: jest.fn(),
}));

await jest.unstable_mockModule('../src/services/stellar.service.js', () => ({
  getStellarExplorerUrl: (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`,
  tokenizeShipment: jest.fn(),
  releaseEscrow: jest.fn(),
}));

const { getPaymentsService, getPaymentByIdService } =
  await import('../src/modules/payments/payments.service.js');
const { getPaymentsController } = await import('../src/modules/payments/payments.controller.js');

// ── Helpers ──────────────────────────────────────────────────────────────────
function makePayment(overrides: Record<string, unknown> = {}) {
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

function makePage(overrides: Record<string, unknown> = {}) {
  return {
    data: [makePayment()],
    total: 1,
    hasMore: false,
    nextCursor: null,
    ...overrides,
  };
}

function makeReqRes(query: Record<string, unknown> = {}, orgId = 'org-123') {
  const req = {
    query,
    user: { organizationId: orgId, userId: 'user-1', role: 'MANAGER' },
  } as unknown as Request;

  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;

  return { req, res, json, status };
}

// ── Service tests ─────────────────────────────────────────────────────────────
describe('getPaymentsService', () => {
  beforeEach(() => {
    getPaymentsByOrganizationMock.mockReset();
    getPaymentByIdMock.mockReset();
  });

  it('returns paginated data with metadata', async () => {
    getPaymentsByOrganizationMock.mockResolvedValue(makePage());

    const result = await getPaymentsService({ organizationId: 'org-1' });

    expect(getPaymentsByOrganizationMock).toHaveBeenCalledWith('org-1', {
      status: undefined,
      limit: undefined,
      cursor: undefined,
    });
    expect(result.data).toHaveLength(1);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
    expect(result.total).toBe(1);
  });

  it('passes status and cursor filters to repo', async () => {
    getPaymentsByOrganizationMock.mockResolvedValue(makePage({ data: [], total: 0 }));

    await getPaymentsService({
      organizationId: 'org-1',
      status: 'Released' as never,
      limit: 5,
      cursor: 'abc',
    });

    expect(getPaymentsByOrganizationMock).toHaveBeenCalledWith('org-1', {
      status: 'Released',
      limit: 5,
      cursor: 'abc',
    });
  });

  it('augments payment with explorerUrl when stellarTxHash present', async () => {
    const payment = makePayment({ stellarTxHash: 'tx-hash-123' });
    getPaymentsByOrganizationMock.mockResolvedValue(makePage({ data: [payment] }));

    const result = await getPaymentsService({ organizationId: 'org-1' });

    expect((result.data[0] as unknown as Record<string, unknown>).explorerUrl).toContain(
      'tx-hash-123'
    );
  });

  it('returns empty data array when no payments exist', async () => {
    getPaymentsByOrganizationMock.mockResolvedValue(makePage({ data: [], total: 0 }));

    const result = await getPaymentsService({ organizationId: 'org-empty' });

    expect(result.data).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  it('returns hasMore=true and nextCursor when more pages exist', async () => {
    getPaymentsByOrganizationMock.mockResolvedValue(
      makePage({ hasMore: true, nextCursor: 'cursor-abc', total: 50 })
    );

    const result = await getPaymentsService({ organizationId: 'org-1', limit: 20 });

    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe('cursor-abc');
  });
});

describe('getPaymentByIdService', () => {
  beforeEach(() => {
    getPaymentByIdMock.mockReset();
  });

  it('returns payment when found', async () => {
    getPaymentByIdMock.mockResolvedValue(makePayment());

    const result = await getPaymentByIdService('507f1f77bcf86cd799439011');

    expect(result).toMatchObject({ amount: 100, tokenType: 'USDC' });
  });

  it('throws 404 AppError when payment not found', async () => {
    getPaymentByIdMock.mockResolvedValue(null);

    await expect(getPaymentByIdService('nonexistent-id')).rejects.toMatchObject({
      statusCode: 404,
      code: 'ERR_PAYMENT_NOT_FOUND',
    });
  });
});

// ── Controller tests ──────────────────────────────────────────────────────────
describe('getPaymentsController', () => {
  beforeEach(() => {
    getPaymentsByOrganizationMock.mockReset();
  });

  it('responds 200 with data and pagination meta', async () => {
    getPaymentsByOrganizationMock.mockResolvedValue(makePage());

    const { req, res, status, json } = makeReqRes({ limit: '20' });
    await getPaymentsController(req, res, jest.fn() as never);

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.any(Array),
        meta: expect.objectContaining({
          hasMore: false,
          nextCursor: null,
          total: 1,
        }),
      })
    );
  });

  it('scopes query to authenticated user organizationId', async () => {
    getPaymentsByOrganizationMock.mockResolvedValue(makePage({ data: [], total: 0 }));

    const { req, res } = makeReqRes({}, 'org-scoped-123');
    await getPaymentsController(req, res, jest.fn() as never);

    expect(getPaymentsByOrganizationMock).toHaveBeenCalledWith(
      'org-scoped-123',
      expect.any(Object)
    );
  });

  it('returns empty array with 200 when no payments exist', async () => {
    getPaymentsByOrganizationMock.mockResolvedValue(makePage({ data: [], total: 0 }));

    const { req, res, status, json } = makeReqRes();
    await getPaymentsController(req, res, jest.fn() as never);

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true, data: [] }));
  });

  it('passes status filter from query to service', async () => {
    getPaymentsByOrganizationMock.mockResolvedValue(makePage({ data: [], total: 0 }));

    const { req, res } = makeReqRes({ status: 'Released', limit: 10 });
    await getPaymentsController(req, res, jest.fn() as never);

    expect(getPaymentsByOrganizationMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: 'Released' })
    );
  });
});
