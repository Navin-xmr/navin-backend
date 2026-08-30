import { AppError, ErrorCodes } from '../../shared/http/errors.js';
import * as paymentsRepo from './payments.repo.js';
import { PaymentStatus } from './payments.model.js';
import type { IPayment } from './payments.model.js';
import type {
  CreatePaymentInput,
  UpdatePaymentStatusInput,
  DisputeSettlementInput,
} from './payments.validation.js';
import { getStellarExplorerUrl } from '../../services/stellar.service.js';
import { emitPaymentStatusChange } from '../../infra/socket/io.js';
import type { SettlementStatusPayload } from '../../shared/types/socketEvents.js';
import { auditLog } from '../../shared/utils/auditLog.js';

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
  // Accept both `token` and legacy `tokenType`
  const token = input.token ?? (input.tokenType as string);
  const payment = await paymentsRepo.createPayment({
    shipmentId: input.shipmentId,
    organizationId: input.organizationId,
    amount: input.amount,
    token,
    tokenType: token,
    payerAddress: input.payerAddress,
    payeeAddress: input.payeeAddress,
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
    throw new AppError(404, 'Settlement not found', ErrorCodes.PAYMENT_NOT_FOUND);
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
 * Retrieves payments for an organization with optional pagination, status filtering, shipment filtering, and sorting.
 * @param {{organizationId: string; status?: PaymentStatus; shipmentId?: string; sortBy?: string; sortOrder?: 'asc' | 'desc'; limit?: number; cursor?: string; page?: number}} input - Payment query parameters.
 * @returns {Promise<PaymentsResult>} Paginated payment list with metadata.
 */
export async function getPaymentsService(input: {
  organizationId: string;
  status?: PaymentStatus;
  shipmentId?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  cursor?: string;
  page?: number;
}): Promise<PaymentsResult> {
  const pageResult = await paymentsRepo.getPaymentsByOrganization(input.organizationId, {
    status: input.status,
    shipmentId: input.shipmentId,
    sortBy: input.sortBy,
    sortOrder: input.sortOrder,
    limit: input.limit,
    cursor: input.cursor,
    page: input.page,
  });
  return {
    data: pageResult.data.map(augmentPayment),
    total: pageResult.total,
    hasMore: pageResult.hasMore,
    nextCursor: pageResult.nextCursor,
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
    throw new AppError(404, 'Settlement not found', ErrorCodes.PAYMENT_NOT_FOUND);
  }

  const oldStatus = payment.status;
  const updated = await paymentsRepo.updatePaymentStatus(id, input.status, input.stellarTxHash);
  if (!updated) {
    throw new AppError(500, 'Failed to update payment status', ErrorCodes.INTERNAL_ERROR);
  }

  const settlementPayload: SettlementStatusPayload = {
    paymentId: updated._id.toString(),
    shipmentId: updated.shipmentId.toString(),
    oldStatus,
    newStatus: updated.status,
    amount: updated.amount,
    ...(updated.stellarTxHash && { txHash: updated.stellarTxHash }),
    timestamp: new Date().toISOString(),
  };
  emitPaymentStatusChange(updated.shipmentId.toString(), settlementPayload);

  return augmentPayment(updated);
}

/**
 * Retrieves a payment linked to a shipment.
 * @param {string} shipmentId - Shipment ObjectId.
 * @returns {Promise<unknown>} Payment record or null.
 */
export async function getPaymentByShipmentService(shipmentId: string) {
  return paymentsRepo.getPaymentByShipmentId(shipmentId);
}

/**
 * Releases a payment by marking it released and attaching Stellar transaction metadata.
 * @param {string} paymentId - Payment ObjectId.
 * @param {string} stellarTxHash - Stellar transaction hash.
 * @param {string=} actorUserId - Optional user who triggered the release.
 * @returns {Promise<unknown>} Updated payment document.
 */
export async function releasePaymentService(
  paymentId: string,
  stellarTxHash: string,
  actorUserId?: string
) {
  const updated = await updatePaymentStatusService(paymentId, {
    status: PaymentStatus.RELEASED,
    stellarTxHash,
  });

  auditLog({
    userId: actorUserId ?? 'system',
    action: 'SETTLEMENT_RELEASED',
    resourceId: paymentId,
    timestamp: new Date(),
    metadata: { stellarTxHash },
  });

  return updated;
}

/**
 * Transitions a settlement to DISPUTED status, recording dispute metadata.
 * Only ADMIN/MANAGER should be permitted to call this (enforced at route level).
 * @param {string} id - Settlement ObjectId.
 * @param {DisputeSettlementInput} input - Dispute reason and optional notes.
 * @returns {Promise<unknown>} Updated settlement document.
 * @throws {AppError} 404 when settlement not found.
 */
export async function disputeSettlementService(id: string, input: DisputeSettlementInput) {
  const payment = await paymentsRepo.getPaymentById(id);
  if (!payment) {
    throw new AppError(404, 'Settlement not found', ErrorCodes.PAYMENT_NOT_FOUND);
  }

  const updated = await paymentsRepo.disputePayment(id, input.reason, input.notes);
  if (!updated) {
    throw new AppError(500, 'Failed to dispute settlement', ErrorCodes.INTERNAL_ERROR);
  }

  const settlementPayload: SettlementStatusPayload = {
    paymentId: updated._id.toString(),
    shipmentId: updated.shipmentId.toString(),
    oldStatus: payment.status,
    newStatus: updated.status,
    amount: updated.amount,
    ...(updated.stellarTxHash && { txHash: updated.stellarTxHash }),
    timestamp: new Date().toISOString(),
  };
  emitPaymentStatusChange(updated.shipmentId.toString(), settlementPayload);

  return augmentPayment(updated);
}
