import { AppError, ErrorCodes } from '../../shared/http/errors.js';
import * as paymentsRepo from './payments.repo.js';
import { PaymentStatus } from './payments.model.js';
import type { IPayment } from './payments.model.js';
import type { CreatePaymentInput, UpdatePaymentStatusInput } from './payments.validation.js';
import { getStellarExplorerUrl } from '../../services/stellar.service.js';

function augmentPayment(payment: IPayment): IPayment & { explorerUrl?: string } {
  return {
    ...payment,
    explorerUrl: payment.stellarTxHash ? getStellarExplorerUrl(payment.stellarTxHash) : undefined,
  };
}

/**
 * Creates a payment record for a shipment.
 * @param {CreatePaymentInput & {organizationId: string}} input - Payment creation payload.
 * @returns {Promise<unknown>} Created payment document.
 * @throws {AppError} When payment data is invalid or creation fails.
 */
export async function createPaymentService(input: CreatePaymentInput & { organizationId: string }) {
  const payment = await paymentsRepo.createPayment({
    shipmentId: input.shipmentId,
    organizationId: input.organizationId,
    amount: input.amount,
    tokenType: input.tokenType,
    status: input.status || PaymentStatus.PENDING,
  });

  return augmentPayment(payment);
}

/**
 * Retrieves a payment by its identifier.
 * @param {string} id - Payment ObjectId.
 * @returns {Promise<unknown>} Payment record.
 * @throws {AppError} When the payment is not found.
 */
export async function getPaymentByIdService(id: string) {
  const payment = await paymentsRepo.getPaymentById(id);
  if (!payment) {
    throw new AppError(404, 'Payment not found', ErrorCodes.PAYMENT_NOT_FOUND);
  }
  return augmentPayment(payment);
}

export interface PaymentsResult {
  data: ReturnType<typeof augmentPayment>[];
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
}

/**
 * Retrieves payments for an organization with optional pagination and status filtering.
 * @param {{organizationId: string; status?: PaymentStatus; limit?: number; cursor?: string}} input - Payment query parameters.
 * @returns {Promise<PaymentsResult>} Paginated payment list with metadata.
 */
export async function getPaymentsService(input: {
  organizationId: string;
  status?: PaymentStatus;
  limit?: number;
  cursor?: string;
}): Promise<PaymentsResult> {
  const page = await paymentsRepo.getPaymentsByOrganization(input.organizationId, {
    status: input.status,
    limit: input.limit,
    cursor: input.cursor,
  });
  return {
    data: page.data.map(augmentPayment),
    total: page.total,
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
  };
}

/**
 * Updates the status of an existing payment.
 * @param {string} id - Payment ObjectId.
 * @param {UpdatePaymentStatusInput} input - Status update fields.
 * @returns {Promise<unknown>} Updated payment document.
 * @throws {AppError} When the payment is missing or update fails.
 */
export async function updatePaymentStatusService(id: string, input: UpdatePaymentStatusInput) {
  const payment = await paymentsRepo.getPaymentById(id);
  if (!payment) {
    throw new AppError(404, 'Payment not found', ErrorCodes.PAYMENT_NOT_FOUND);
  }

  const updated = await paymentsRepo.updatePaymentStatus(id, input.status, input.stellarTxHash);
  if (!updated) {
    throw new AppError(500, 'Failed to update payment status', 'PAYMENT_UPDATE_FAILED');
  }

  return augmentPayment(updated);
}

/**
 * Retrieves a payment linked to a shipment.
 * @param {string} shipmentId - Shipment ObjectId.
 * @returns {Promise<unknown>} Payment record or null.
 */
export async function getPaymentByShipmentService(shipmentId: string) {
  const payment = await paymentsRepo.getPaymentByShipmentId(shipmentId);
  return payment;
}

/**
 * Releases a payment by marking it released and attaching Stellar transaction metadata.
 * @param {string} paymentId - Payment ObjectId.
 * @param {string} stellarTxHash - Stellar transaction hash.
 * @returns {Promise<unknown>} Updated payment document.
 */
export async function releasePaymentService(paymentId: string, stellarTxHash: string) {
  return updatePaymentStatusService(paymentId, {
    status: PaymentStatus.RELEASED,
    stellarTxHash,
  });
}
