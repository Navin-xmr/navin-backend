/**
 * Chain confirmation tracking for realtime socket events (#1067).
 *
 * Tracks escrow events reaching confirmation depth and emits socket events
 * (settlement:status, shipment:status, anomaly:detected) with txHash and ledger
 * included for client verification.
 *
 * Usage: pass adapter instance to confirmChainEvents(); typically invoked by a
 * background worker on a regular cadence (e.g., every 10s, or on ledger-closed hooks).
 */
import { PaymentModel, PaymentStatus } from '../../modules/payments/payments.model.js';
import { Anomaly } from '../../modules/anomaly/anomaly.model.js';
import {
  emitStatusUpdate,
  emitPaymentStatusChange,
  emitAnomalyDetected,
} from '../../infra/socket/io.js';
import { logger } from '../../shared/logger/logger.js';
import type { ChainAdapter } from './types.js';

/** A record is confirmed once its ledger has at least this many ledgers on top of it. */
export const MIN_CONFIRMATION_LEDGERS = 3;

export interface ChainConfirmationSummary {
  /** Payments checked for confirmation. */
  paymentsChecked: number;
  /** Payments emitted settlement:status socket events. */
  settlementEventsEmitted: number;
  /** Shipment status events emitted on escrow release. */
  shipmentEventsEmitted: number;
  /** Anomaly events emitted on breach detection. */
  anomalyEventsEmitted: number;
  /** Records that had ledger lookup or update failures. */
  errors: number;
}

/**
 * Number of confirmations including the transaction's own ledger.
 * A transaction in the latest ledger has depth 1.
 */
export function confirmationDepth(latestLedger: number, txLedger: number): number {
  return latestLedger >= txLedger ? latestLedger - txLedger + 1 : 0;
}

/**
 * Poll confirmed escrow events; emit socket events when confirmation depth is reached.
 *
 * - Finds payments with stellarTxHash and ESCROWED or RELEASED status
 * - Checks ledger depth of each transaction via adapter
 * - Emits settlement:status (with txHash, ledger) when depth >= minDepth
 * - For RELEASED payments, also emits shipment:status SETTLEMENT_COMPLETED
 * - Emits anomaly:detected for related anomalies (e.g., detected on-chain)
 * - Updates confirmations and stellarTxLedger fields in payment document
 *
 * Idempotent: repeated runs do not double-emit because we check the
 * confirmations field to detect already-emitted events.
 *
 * @throws {Error} if adapter lacks getLatestLedger or getTransactionLedger
 */
export async function confirmChainEvents(
  adapter: ChainAdapter,
  options: { limit?: number; minDepth?: number } = {}
): Promise<ChainConfirmationSummary> {
  const limit = options.limit ?? 100;
  const minDepth = options.minDepth ?? MIN_CONFIRMATION_LEDGERS;
  const summary: ChainConfirmationSummary = {
    paymentsChecked: 0,
    settlementEventsEmitted: 0,
    shipmentEventsEmitted: 0,
    anomalyEventsEmitted: 0,
    errors: 0,
  };

  if (!adapter.getLatestLedger || !adapter.getTransactionLedger) {
    throw new Error('ChainAdapter must support getLatestLedger and getTransactionLedger');
  }

  // Find payments with on-chain transactions that haven't yet been confirmed.
  const candidates = await PaymentModel.find({
    $and: [
      { stellarTxHash: { $ne: null } },
      { stellarTxHash: { $ne: '' } },
      { status: { $in: [PaymentStatus.ESCROWED, PaymentStatus.RELEASED] } },
      { $expr: { $lt: [{ $ifNull: ['$confirmations', 0] }, minDepth] } },
      { deletedAt: null },
    ],
  })
    .sort({ updatedAt: 1 })
    .limit(limit)
    .select('_id shipmentId amount status stellarTxHash stellarTxLedger confirmations')
    .lean();

  if (candidates.length === 0) {
    return summary;
  }

  const latestLedger = await adapter.getLatestLedger();

  for (const payment of candidates as Array<{
    _id: { toString(): string } | string;
    shipmentId: { toString(): string } | string;
    amount: number;
    status: PaymentStatus;
    stellarTxHash: string;
    stellarTxLedger?: number;
    confirmations?: number;
  }>) {
    summary.paymentsChecked += 1;
    const paymentIdStr = String(payment._id);
    const shipmentIdStr = String(payment.shipmentId);

    try {
      const txLedger = await adapter.getTransactionLedger(payment.stellarTxHash);
      if (txLedger === null) {
        // Transaction not yet found on chain; await next poll
        continue;
      }

      const depth = confirmationDepth(latestLedger, txLedger);
      if (depth < minDepth) {
        // Not yet deep enough
        continue;
      }

      // Update the payment with confirmation metadata
      const updateResult = await PaymentModel.updateOne(
        { _id: payment._id, $expr: { $lt: [{ $ifNull: ['$confirmations', 0] }, minDepth] } },
        {
          $set: {
            stellarTxLedger: txLedger,
            confirmations: depth,
          },
        }
      );

      // Only emit events if we actually updated the record (prevents double-emit)
      if (updateResult.modifiedCount === 0) {
        continue;
      }

      // Emit settlement:status socket event with txHash and ledger
      emitPaymentStatusChange(shipmentIdStr, {
        paymentId: paymentIdStr,
        shipmentId: shipmentIdStr,
        oldStatus: PaymentStatus.ESCROWED,
        newStatus: payment.status,
        amount: payment.amount,
        txHash: payment.stellarTxHash,
        timestamp: new Date().toISOString(),
      });
      summary.settlementEventsEmitted += 1;

      // If payment is RELEASED, also emit shipment:status SETTLEMENT_COMPLETED
      if (payment.status === PaymentStatus.RELEASED) {
        emitStatusUpdate(shipmentIdStr, {
          shipmentId: shipmentIdStr,
          status: 'SETTLEMENT_COMPLETED',
          updatedAt: new Date().toISOString(),
        });
        summary.shipmentEventsEmitted += 1;
      }

      // Emit anomaly:detected for any related high-severity anomalies
      const anomalies = await Anomaly.find({
        shipmentId: payment.shipmentId,
        severity: 'HIGH',
        deletedAt: null,
      }).limit(5);

      for (const anomaly of anomalies) {
        emitAnomalyDetected(shipmentIdStr, {
          anomalyId: anomaly._id.toString(),
          shipmentId: shipmentIdStr,
          type: anomaly.type,
          severity: anomaly.severity,
          message: anomaly.message,
          timestamp:
            anomaly.timestamp instanceof Date
              ? anomaly.timestamp.toISOString()
              : String(anomaly.timestamp),
          resolved: anomaly.resolved,
        });
        summary.anomalyEventsEmitted += 1;
      }
    } catch (err) {
      summary.errors += 1;
      logger.error(
        {
          error: err instanceof Error ? err.message : String(err),
          paymentId: payment._id,
          txHash: payment.stellarTxHash,
        },
        '[Chain] Confirmation tracking error'
      );
    }
  }

  return summary;
}
