import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { AppError } from '../src/shared/http/errors.js';
import { createLedgerBlock } from '../src/modules/ledger/ledger.repo.js';

const getLedgerBlocksServiceMock = jest.fn();
const getLedgerBlockByIdServiceMock = jest.fn();

await jest.unstable_mockModule('../src/modules/ledger/ledger.service.js', () => ({
  getLedgerBlocksService: getLedgerBlocksServiceMock,
  getLedgerBlockByIdService: getLedgerBlockByIdServiceMock,
}));

const { getLedgerBlocks, getLedgerBlockById } = await import(
  '../src/modules/ledger/ledger.controller.js',
);

describe('GET /api/ledger/blocks controller', () => {
  beforeEach(() => {
    getLedgerBlocksServiceMock.mockReset();
    getLedgerBlockByIdServiceMock.mockReset();
  });

  it('passes the validated ledger block id parameter to the service', async () => {
    getLedgerBlockByIdServiceMock.mockResolvedValue({ _id: 'lb1' });

    const req = { params: { id: 'lb1' } } as any;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any;

    await getLedgerBlockById(req, res);

    expect(getLedgerBlockByIdServiceMock).toHaveBeenCalledWith('lb1');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('throws AppError 400 with a registered code when milestoneEvent is missing', async () => {
    await expect(
      createLedgerBlock({ shipmentId: '507f1f77bcf86cd799439011' }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'ERR_BAD_REQUEST',
      message: 'milestoneEvent or eventType is required',
    });
  });

  it('returns 200 with envelope {success,message,data,meta}', async () => {
    getLedgerBlocksServiceMock.mockResolvedValue({
      data: [
        {
          _id: 'lb1',
          shipmentId: '507f1f77bcf86cd799439011',
          milestoneEvent: 'DELIVERED',
          blockNumber: 101,
          ledger: 101,
          verified: true,
        },
      ],
      nextCursor: 'lb1',
      hasMore: true,
      total: 2,
    });

    const req = {
      query: { limit: '1' },
    } as any;

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any;

    await getLedgerBlocks(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Ledger blocks retrieved',
      data: expect.any(Array),
      meta: {
        total: 2,
        hasMore: true,
        nextCursor: 'lb1',
      },
    });
  });

  it('passes milestoneEvent filter to service', async () => {
    getLedgerBlocksServiceMock.mockResolvedValue({
      data: [{ _id: 'lb1', milestoneEvent: 'SETTLEMENT_COMPLETED' }],
      nextCursor: null,
      hasMore: false,
      total: 1,
    });

    const req = {
      query: { milestoneEvent: 'SETTLEMENT_COMPLETED', limit: '10' },
    } as any;

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any;

    await getLedgerBlocks(req, res);

    expect(getLedgerBlocksServiceMock).toHaveBeenCalledWith(
      expect.objectContaining({ milestoneEvent: 'SETTLEMENT_COMPLETED' }),
    );
  });

  it('returns 200 with empty array when no ledger blocks match filters', async () => {
    getLedgerBlocksServiceMock.mockResolvedValue({
      data: [],
      nextCursor: null,
      hasMore: false,
      total: 0,
    });

    const req = { query: {} } as any;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any;

    await getLedgerBlocks(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Ledger blocks retrieved',
      data: [],
      meta: {
        total: 0,
        hasMore: false,
        nextCursor: null,
      },
    });
  });
});
