import { AppError } from '../../shared/http/errors.js';
import * as paymentsService from '../payments/payments.service.js';
import { PaymentStatus } from '../payments/payments.model.js';
import type { StellarWebhookPayload } from './stellar.webhook.validation.js';
import { logger } from '../../shared/logger/logger.js';

/**
 * Handles incoming Stellar proof-of-delivery webhook events.
 * @param {StellarWebhookPayload} payload - Validated Stellar webhook payload.
 * @returns {Promise<unknown>} The processed webhook event result.
 * @throws {AppError} When the webhook event type is unknown or processing fails.
 */
export async function handleStellarWebhookEvent(payload: StellarWebhookPayload) {
  const { type, paymentId, transactionHash } = payload;

  logger.info({ type, paymentId }, 'Stellar webhook event received');

  try {
    switch (type) {
      case 'release':
        return await handleReleaseEvent(paymentId, transactionHash);
      case 'escrow':
        return await handleEscrowEvent(paymentId, transactionHash);
      case 'failed':
        return await handleFailedEvent(paymentId);
      default:
        throw new AppError(400, `Unknown webhook event type: ${type}`, 'UNKNOWN_EVENT_TYPE');
    }
  } catch (error) {
    logger.error({ err: error, type, paymentId }, 'Stellar webhook processing failed');
    throw error;
  }
}

async function handleReleaseEvent(paymentId: string, transactionHash: string) {
  await paymentsService.updatePaymentStatusService(paymentId, {
    status: PaymentStatus.RELEASED,
    stellarTxHash: transactionHash,
  });

  logger.info({ paymentId, transactionHash }, 'Payment marked as RELEASED');

  return {
    event: 'release',
    paymentId,
    status: PaymentStatus.RELEASED,
    transactionHash,
  };
}

async function handleEscrowEvent(paymentId: string, transactionHash: string) {
  await paymentsService.updatePaymentStatusService(paymentId, {
    status: PaymentStatus.ESCROWED,
    stellarTxHash: transactionHash,
  });

  logger.info({ paymentId, transactionHash }, 'Payment marked as ESCROWED');

  return {
    event: 'escrow',
    paymentId,
    status: PaymentStatus.ESCROWED,
    transactionHash,
  };
}

async function handleFailedEvent(paymentId: string) {
  await paymentsService.updatePaymentStatusService(paymentId, {
    status: PaymentStatus.FAILED,
  });

  logger.info({ paymentId }, 'Payment marked as FAILED');

  return {
    event: 'failed',
    paymentId,
    status: PaymentStatus.FAILED,
  };
}
