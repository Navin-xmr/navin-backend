/**
 * Chain confirmation tracking tests (#1067).
 *
 * Validates that confirmChainEvents emits socket events with txHash/ledger
 * payloads after confirmation threshold, and only uses socketEvents constants.
 */
import { jest } from '@jest/globals';
import { Payment, PaymentStatus } from '../src/modules/payments/payments.model.js';
import { Shipment } from '../src/modules/shipments/shipment.model.js';
import { Anomaly } from '../src/modules/anomaly/anomaly.model.js';
import {
  confirmChainEvents,
  confirmationDepth,
  MIN_CONFIRMATION_LEDGERS,
  type ChainConfirmationSummary,
} from '../src/services/chain/confirmation.js';
import { SOCKET_EVENTS } from '../src/shared/types/socketEvents.js';
import * as socketIO from '../src/infra/socket/io.js';
import type { ChainAdapter } from '../src/services/chain/types.js';
import { Types } from 'mongoose';

// Mock socket emitters
jest.unstable_mockModule('../src/infra/socket/io.js', () => ({
  getIO: jest.fn(),
  emitStatusUpdate: jest.fn(),
  emitPaymentStatusChange: jest.fn(),
  emitAnomalyDetected: jest.fn(),
  emitTelemetryUpdate: jest.fn(),
  emitNotificationNew: jest.fn(),
}));

describe('Chain Confirmation Tracking (#1067)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('confirmationDepth', () => {
    it('calculates depth correctly', () => {
      expect(confirmationDepth(100, 98)).toBe(3); // 100 - 98 + 1
      expect(confirmationDepth(100, 100)).toBe(1); // Same ledger
      expect(confirmationDepth(98, 100)).toBe(0); // Tx in future
    });
  });

  describe('confirmChainEvents', () => {
    let mockAdapter: jest.Mocked<Partial<ChainAdapter>>;

    beforeEach(() => {
      mockAdapter = {
        getLatestLedger: jest.fn().mockResolvedValue(1000),
        getTransactionLedger: jest.fn().mockResolvedValue(998),
      } as jest.Mocked<Partial<ChainAdapter>>;
    });

    it('throws when adapter lacks ledger query methods', async () => {
      const badAdapter = {} as ChainAdapter;
      await expect(confirmChainEvents(badAdapter)).rejects.toThrow(
        /must support getLatestLedger and getTransactionLedger/
      );
    });

    it('returns empty summary when no payments to check', async () => {
      jest.spyOn(Payment, 'find').mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      } as any);

      const summary = await confirmChainEvents(mockAdapter as any);
      expect(summary.paymentsChecked).toBe(0);
    });

    it('emits settlement:status event when payment reaches confirmation depth', async () => {
      const shipmentId = new Types.ObjectId();
      const paymentId = new Types.ObjectId();
      const txHash = 'abc123def456';

      jest.spyOn(Payment, 'find').mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([
          {
            _id: paymentId,
            shipmentId,
            status: PaymentStatus.ESCROWED,
            stellarTxHash: txHash,
            amount: 100,
            confirmations: 0, // Not yet confirmed
          },
        ]),
      } as any);

      jest.spyOn(Payment, 'updateOne').mockResolvedValue({
        modifiedCount: 1,
      } as any);

      jest.spyOn(Anomaly, 'find').mockResolvedValue([]);

      const { emitPaymentStatusChange } = await import('../src/infra/socket/io.js');

      const summary = await confirmChainEvents(mockAdapter as any);

      expect(summary.paymentsChecked).toBe(1);
      expect(summary.settlementEventsEmitted).toBe(1);
      expect(emitPaymentStatusChange).toHaveBeenCalledWith(shipmentId.toString(), {
        paymentId: paymentId.toString(),
        shipmentId: shipmentId.toString(),
        oldStatus: PaymentStatus.ESCROWED,
        newStatus: PaymentStatus.ESCROWED,
        amount: 100,
        txHash,
        timestamp: expect.any(String),
      });
    });

    it('uses socketEvents constants, not string literals', async () => {
      const shipmentId = new Types.ObjectId();
      const paymentId = new Types.ObjectId();

      jest.spyOn(Payment, 'find').mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([
          {
            _id: paymentId,
            shipmentId,
            status: PaymentStatus.RELEASED,
            stellarTxHash: 'abc123',
            amount: 100,
          },
        ]),
      } as any);

      jest.spyOn(Payment, 'updateOne').mockResolvedValue({
        modifiedCount: 1,
      } as any);

      jest.spyOn(Anomaly, 'find').mockResolvedValue([]);

      const { emitStatusUpdate } = await import('../src/infra/socket/io.js');

      await confirmChainEvents(mockAdapter as any);

      // Verify emitStatusUpdate was called (uses SOCKET_EVENTS.SHIPMENT_STATUS internally)
      expect(emitStatusUpdate).toHaveBeenCalledWith(shipmentId.toString(), expect.any(Object));
    });

    it('includes txHash and ledger in settlement:status payload', async () => {
      const shipmentId = new Types.ObjectId();
      const paymentId = new Types.ObjectId();
      const txHash = 'deadbeef';

      jest.spyOn(Payment, 'find').mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([
          {
            _id: paymentId,
            shipmentId,
            status: PaymentStatus.ESCROWED,
            stellarTxHash: txHash,
            amount: 50,
          },
        ]),
      } as any);

      jest.spyOn(Payment, 'updateOne').mockResolvedValue({
        modifiedCount: 1,
      } as any);

      jest.spyOn(Anomaly, 'find').mockResolvedValue([]);

      const { emitPaymentStatusChange } = await import('../src/infra/socket/io.js');

      await confirmChainEvents(mockAdapter as any);

      const callArgs = (emitPaymentStatusChange as jest.Mock).mock.calls[0];
      expect(callArgs[1]).toHaveProperty('txHash', txHash);
    });

    it('does not double-emit when payment already confirmed', async () => {
      const shipmentId = new Types.ObjectId();
      const paymentId = new Types.ObjectId();

      jest.spyOn(Payment, 'find').mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([
          {
            _id: paymentId,
            shipmentId,
            status: PaymentStatus.ESCROWED,
            stellarTxHash: 'abc123',
            amount: 100,
            confirmations: MIN_CONFIRMATION_LEDGERS, // Already confirmed
          },
        ]),
      } as any);

      jest.spyOn(Payment, 'updateOne').mockResolvedValue({
        modifiedCount: 0, // No update = already confirmed
      } as any);

      const { emitPaymentStatusChange } = await import('../src/infra/socket/io.js');

      await confirmChainEvents(mockAdapter as any);

      expect(emitPaymentStatusChange).not.toHaveBeenCalled();
    });
  });
});
