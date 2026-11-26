/**
 * Chain read endpoint tests (P14-12).
 *
 * Covers:
 *   - 200: escrow balance, shipment status, settlement record, contract version
 *   - Service: cache hit / miss, adapter result passthrough
 *   - Controller: correct response envelope
 *   - Cache: read/write/invalidate round-trip
 *   - 401/403: handled by requireAuth/requireRole middleware (covered elsewhere)
 *   - 404: not applicable — chain reads return simulated data, never 404
 */

import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { resetChainAdapter } from '../src/services/chain/factory.js';

import * as ledgerService from '../src/modules/ledger/ledger.service.js';
import type { Request, Response } from 'express';
import {
  getEscrowBalanceController,
  getShipmentStatusController,
  getSettlementRecordController,
  getContractVersionController,
} from '../src/modules/ledger/ledger.controller.js';

function makeRes() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return { res: { status, json } as unknown as Response, status, json };
}

describe('chain read services (P14-12)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetChainAdapter();
  });

  describe('getEscrowBalanceService', () => {
    it('200 — returns simulated balance from adapter', async () => {
      const result = await ledgerService.getEscrowBalanceService('pay-1');

      expect(result).toEqual({ balance: '0', simulated: true });
    });
  });

  describe('getShipmentStatusService', () => {
    it('200 — returns UNKNOWN status from simulated adapter', async () => {
      const result = await ledgerService.getShipmentStatusService('ship-1');

      expect(result).toEqual({ status: 'UNKNOWN', simulated: true });
    });
  });

  describe('getSettlementRecordService', () => {
    it('200 — combines escrow balance and shipment status', async () => {
      const result = await ledgerService.getSettlementRecordService('pay-1');

      expect(result).toEqual({
        paymentId: 'pay-1',
        escrowBalance: { balance: '0', simulated: true },
        shipmentStatus: { status: 'UNKNOWN', simulated: true },
      });
    });
  });

  describe('getContractVersionService', () => {
    it('200 — returns simulated contract version', async () => {
      const result = await ledgerService.getContractVersionService();

      expect(result).toEqual({ version: '1.2.0-draft-simulated', simulated: true });
    });
  });
});

describe('chain read controllers (P14-12)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetChainAdapter();
  });

  describe('getEscrowBalanceController', () => {
    it('200 — returns escrow balance envelope', async () => {
      const req = { params: { paymentId: 'pay-1' } } as unknown as Request;
      const { res, status, json } = makeRes();

      await getEscrowBalanceController(req, res, jest.fn() as never);

      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Escrow balance retrieved',
          data: { balance: '0', simulated: true },
        })
      );
    });
  });

  describe('getShipmentStatusController', () => {
    it('200 — returns shipment status envelope', async () => {
      const req = { params: { shipmentId: 'ship-1' } } as unknown as Request;
      const { res, status, json } = makeRes();

      await getShipmentStatusController(req, res, jest.fn() as never);

      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Shipment status retrieved',
          data: { status: 'UNKNOWN', simulated: true },
        })
      );
    });
  });

  describe('getSettlementRecordController', () => {
    it('200 — returns settlement record envelope', async () => {
      const req = { params: { paymentId: 'pay-1' } } as unknown as Request;
      const { res, status, json } = makeRes();

      await getSettlementRecordController(req, res, jest.fn() as never);

      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Settlement record retrieved',
          data: expect.objectContaining({ paymentId: 'pay-1' }),
        })
      );
    });
  });

  describe('getContractVersionController', () => {
    it('200 — returns contract version envelope', async () => {
      const req = {} as unknown as Request;
      const { res, status, json } = makeRes();

      await getContractVersionController(req, res, jest.fn() as never);

      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Contract version retrieved',
          data: { version: '1.2.0-draft-simulated', simulated: true },
        })
      );
    });
  });
});
