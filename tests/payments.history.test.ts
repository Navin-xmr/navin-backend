import { jest, describe, it, beforeEach, expect } from '@jest/globals';
import { Types } from 'mongoose';
import type { Request, Response } from 'express';
import { createChainFactoryMock } from './helpers/mocks.js';

const PAYMENT_ID = new Types.ObjectId().toString();
const SHIPMENT_ID = new Types.ObjectId().toString();
const ORGANIZATION_ID = new Types.ObjectId().toString();
const EMPTY_ORGANIZATION_ID = new Types.ObjectId().toString();
const SCOPED_ORGANIZATION_ID = new Types.ObjectId().toString();
const USER_ID = new Types.ObjectId().toString();

// ── Repo mock ────────────────────────────────────────────────────────────────
const getPaymentsByOrganizationMock =
  jest.fn<(orgId: string, filters?: unknown) => Promise<unknown>>();
const getPaymentByIdMock = jest.fn<(id: string) => Promise<unknown>>();

jest.resetModules();

await jest.unstable_mockModule('../src/modules/payments/payments.repo.js', () => ({
  getPaymentsByOrganization: getPaymentsByOrganizationMock,
  getPaymentById: getPaymentByIdMock,
  createPayment: jest.fn(),
  updatePaymentStatus: jest.fn(),
  getPaymentByShipmentId: jest.fn(),
  deletePayment: jest.fn(),
}));

await jest.unstable_mockModule('../src/services/chain/factory.js', () => createChainFactoryMock());

const { getPaymentsService, getPaymentByIdService } =
  await import('../src/modules/payments/payments.service.js');
const { getPaymentsController } = await import('../src/modules/payments/payments.controller.js');

// ── Helpers ──────────────────────────────────────────────────────────────────
const { paymentDoc } = await import('./fixtures/factories.js');
const makePayment = paymentDoc;

function makePage(overrides: Record<string, unknown> = {}) {
  return {
    data: [makePayment()],
    total: 1,
    hasMore: false,
    nextCursor: null,
    ...overrides,
  };
}

function makeReqRes(query: Record<string, unknown> = {}, orgId = ORGANIZATION_ID) {
  const req = {
    query,
    user: { organizationId: orgId, userId: USER_ID, role: 'MANAGER' },
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

    const result = await getPaymentsService({ organizationId: ORGANIZATION_ID });

    expect(getPaymentsByOrganizationMock).toHaveBeenCalledWith(ORGANIZATION_ID, {
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
      organizationId: ORGANIZATION_ID,
      status: 'Released' as never,
      limit: 5,
      cursor: 'abc',
    });

    expect(getPaymentsByOrganizationMock).toHaveBeenCalledWith(ORGANIZATION_ID, {
      status: 'Released',
      limit: 5,
      cursor: 'abc',
    });
  });

  it('augments payment with explorerUrl when stellarTxHash present', async () => {
    const payment = makePayment({ stellarTxHash: 'tx-hash-123' });
    getPaymentsByOrganizationMock.mockResolvedValue(makePage({ data: [payment] }));

    const result = await getPaymentsService({ organizationId: ORGANIZATION_ID });

    expect((result.data[0] as unknown as Record<string, unknown>).explorerUrl).toContain(
      'tx-hash-123'
    );
  });

  it('returns empty data array when no payments exist', async () => {
    getPaymentsByOrganizationMock.mockResolvedValue(makePage({ data: [], total: 0 }));

    const result = await getPaymentsService({ organizationId: EMPTY_ORGANIZATION_ID });

    expect(result.data).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  it('returns hasMore=true and nextCursor when more pages exist', async () => {
    getPaymentsByOrganizationMock.mockResolvedValue(
      makePage({ hasMore: true, nextCursor: 'cursor-abc', total: 50 })
    );

    const result = await getPaymentsService({ organizationId: ORGANIZATION_ID, limit: 20 });

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

    const result = await getPaymentByIdService(PAYMENT_ID);

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

    const { req, res } = makeReqRes({}, SCOPED_ORGANIZATION_ID);
    await getPaymentsController(req, res, jest.fn() as never);

    expect(getPaymentsByOrganizationMock).toHaveBeenCalledWith(
      SCOPED_ORGANIZATION_ID,
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
