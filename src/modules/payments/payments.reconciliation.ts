/**
 * Escrow reconciliation (P13-12).
 *
 * Reconciles payment/settlement records against on-chain escrow events:
 *   - `esc_init`        -> escrow_deposited  -> PaymentStatus.ESCROWED
 *   - `esc_rel`         -> escrow_released   -> PaymentStatus.RELEASED (amount present)
 *   - `escrow_released` -> escrow_released   -> PaymentStatus.RELEASED (no amount on event)
 *   - `esc_resolve`     -> escrow_refunded   -> PaymentStatus.REFUNDED (outcome: refund_payer)
 *
 * Amounts are compared in stroops (integer) so reconciliation has no float
 * drift. Settlement status is driven by the chain event only. On amount
 * mismatch an alert is returned and the payment is left untouched -- the DB
 * never claims funds the chain did not release.
 */
import { AppError, ErrorCodes } from '../../shared/http/errors.js';
import { PaymentStatus } from './payments.model.js';
import type { IPayment } from './payments.model.js';
import type { ChainEvent } from '../../shared/types/chain.js';
import { CHAIN_EVENT_NAMES } from '../../shared/types/chain.js';
import * as paymentsRepo from './payments.repo.js';
import { emitPaymentStatusChange } from '../../infra/socket/io.js';
import type { SettlementStatusPayload } from '../../shared/types/socketEvents.js';
import { dispatchAlert } from '../../services/queue.service.js';

/** 1 XLM = 10^7 stroops (Stellar native asset, 7 decimals). */
const STROOPS_PER_XLM = 10_000_000n;

/** Refund outcome emitted by `esc_resolve` when funds return to the payer. */
const REFUND_OUTCOME = 'refund_payer';

/** Convert on-chain stroops to 7-decimal XLM without float drift. */
export function stroopsTo7Decimal(stroops: string | bigint): number {
  const big = typeof stroops === 'string' ? BigInt(stroops) : stroops;
  return Number(big) / Number(STROOPS_PER_XLM);
}

/** Convert a 7-decimal XLM amount to stroops (exact integer). */
export function amountToStroops(amount: number): bigint {
  return BigInt(Math.round(amount * Number(STROOPS_PER_XLM)));
}

export interface EscrowReconcileAlert {
  type: 'ESCROW_AMOUNT_MISMATCH';
  message: string;
  paymentId: string;
  shipmentId: string;
  chainAmountStroops: string;
  dbAmountStroops: string;
}

export interface EscrowReconcileDecision {
  reconciled: boolean;
  /** New payment status when reconciled. */
  status?: PaymentStatus;
  /** 7-decimal XLM amount from chain (only when the event carries an amount). */
  amount?: number;
  stellarTxHash?: string;
  /** Present when chain and DB amounts disagree -- no write must occur. */
  alert?: EscrowReconcileAlert;
}

/**
 * Reconcile a single chain escrow event against a payment record.
 * Returns a decision; the caller applies it via `applyReconciliation`.
 */
export function reconcileEscrowEvent(
  payment: IPayment,
  event: ChainEvent
): EscrowReconcileDecision {
  const { name } = event;

  let status: PaymentStatus;
  let chainAmountStroops: string | undefined;

  switch (name) {
    case CHAIN_EVENT_NAMES.ESCROW_INIT: // escrow_deposited
      status = PaymentStatus.ESCROWED;
      chainAmountStroops = event.data[4];
      break;
    case CHAIN_EVENT_NAMES.ESCROW_RELEASE: // escrow_released (amount present)
      status = PaymentStatus.RELEASED;
      chainAmountStroops = event.data[2];
      break;
    case CHAIN_EVENT_NAMES.ESCROW_RELEASED: // escrow_released (co-emitted, no amount)
      status = PaymentStatus.RELEASED;
      break;
    case CHAIN_EVENT_NAMES.ESCROW_RESOLVE: // escrow_refunded
      if (event.data[0] === REFUND_OUTCOME) {
        status = PaymentStatus.REFUNDED;
      } else {
        return { reconciled: false };
      }
      break;
    default:
      return { reconciled: false };
  }

  const stellarTxHash = event.tx_hash;

  // Amount reconciliation -- exact integer comparison in stroops, no float drift.
  if (chainAmountStroops !== undefined) {
    const dbStroops = amountToStroops(payment.amount);
    const chainStroops = BigInt(chainAmountStroops);
    if (dbStroops !== chainStroops) {
      return {
        reconciled: false,
        alert: {
          type: 'ESCROW_AMOUNT_MISMATCH',
          message: `Escrow amount mismatch for payment ${payment._id}: DB ${payment.amount} XLM (${dbStroops} stroops) vs chain ${chainAmountStroops} stroops`,
          paymentId: payment._id.toString(),
          shipmentId: payment.shipmentId.toString(),
          chainAmountStroops,
          dbAmountStroops: dbStroops.toString(),
        },
      };
    }
  }

  return {
    reconciled: true,
    status,
    amount:
      chainAmountStroops !== undefined ? stroopsTo7Decimal(chainAmountStroops) : payment.amount,
    stellarTxHash,
  };
}

/**
 * Apply a reconciliation decision to the payment record.
 *
 * - reconciled: persist status + tx hash, emit `settlement:status`.
 * - not reconciled + alert: dispatch the alert, no DB write (never claim funds
 *   the chain did not release).
 */
export async function applyReconciliation(
  payment: IPayment,
  decision: EscrowReconcileDecision
): Promise<IPayment | null> {
  if (!decision.reconciled) {
    if (decision.alert) {
      await dispatchAlert({
        type: 'STATUS_CHANGE',
        message: decision.alert.message,
        shipmentId: decision.alert.shipmentId,
      });
    }
    return payment;
  }

  const updated = await paymentsRepo.updatePaymentStatus(
    payment._id.toString(),
    decision.status!,
    decision.stellarTxHash
  );
  if (!updated) {
    throw new AppError(500, 'Failed to apply escrow reconciliation', ErrorCodes.INTERNAL_ERROR);
  }

  const payload: SettlementStatusPayload = {
    paymentId: updated._id.toString(),
    shipmentId: updated.shipmentId.toString(),
    oldStatus: payment.status,
    newStatus: updated.status,
    amount: updated.amount,
    ...(updated.stellarTxHash && { txHash: updated.stellarTxHash }),
    timestamp: new Date().toISOString(),
  };
  emitPaymentStatusChange(updated.shipmentId.toString(), payload);

  return updated;
}
