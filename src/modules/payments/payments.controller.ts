import type { Request, Response } from 'express';
import * as paymentsService from './payments.service.js';
import { getSettlementSummaryService } from './settlements.summary.service.js';
import { sendResponse } from '../../shared/http/sendResponse.js';
import { asyncHandler } from '../../shared/http/asyncHandler.js';

/**
 * Creates a payment/settlement for a shipment under the caller's organization.
 * Requires auth; route restricts create to ADMIN / SUPER_ADMIN.
 *
 * @param req.body.shipmentId - Shipment to settle.
 * @param req.body.amount - Positive settlement amount.
 * @param req.body.token - Settlement asset (`XLMN` | `USDC` | `Other`); `tokenType` accepted as legacy alias.
 * @param req.body.payerAddress - Optional payer wallet address.
 * @param req.body.payeeAddress - Optional payee wallet address.
 * @param req.body.status - Optional initial status (defaults to PENDING).
 * @returns HTTP 201 with envelope `{ success, message, data }` containing the created payment.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when the caller lacks ADMIN / SUPER_ADMIN.
 * @throws {AppError} 400 VALIDATION_ERROR — when body validation fails.
 */
export const createPaymentController = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const payment = await paymentsService.createPaymentService({
      ...req.body,
      organizationId: req.user?.organizationId ?? '',
    });
    sendResponse(res, 201, true, 'Payment created successfully', payment);
  }
);

/**
 * Retrieves a settlement/payment by id (legacy export; same behavior as settlement detail).
 * Requires authentication (router-level `requireAuth`).
 *
 * @param req.params.id - Payment/settlement id.
 * @returns HTTP 200 with envelope `{ success, message, data }` containing the settlement.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 404 ERR_PAYMENT_NOT_FOUND — when the settlement does not exist.
 * @throws {AppError} 400 VALIDATION_ERROR — when the id param is invalid.
 */
export const getPaymentController = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const payment = await paymentsService.getPaymentByIdService(req.params.id);
    sendResponse(res, 200, true, 'Settlement retrieved successfully', payment);
  }
);

/**
 * Lists payments for the caller's organization with cursor pagination.
 * Requires authentication.
 *
 * @param req.query.status - Optional payment status filter.
 * @param req.query.limit - Page size (default 20, max 100).
 * @param req.query.cursor - Optional cursor for the next page.
 * @returns HTTP 200 with envelope `{ success, message, data, meta }` (`total`, `hasMore`, `nextCursor`).
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 400 VALIDATION_ERROR — when query validation fails.
 */
export const getPaymentsController = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const query = req.query as unknown as import('./payments.validation.js').GetPaymentsQuery;
    const result = await paymentsService.getPaymentsService({
      organizationId: req.user?.organizationId ?? '',
      status: query.status,
      shipmentId: query.shipmentId,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      limit: query.limit,
      cursor: query.cursor,
      page: query.page,
    });

    // Build meta based on pagination mode
    const meta: Record<string, unknown> = { total: result.total };

    if (query.page !== undefined) {
      // Offset-based pagination
      meta.page = query.page;
      meta.limit = query.limit;
    } else {
      // Cursor-based pagination
      meta.hasMore = result.hasMore;
      meta.nextCursor = result.nextCursor;
    }

    sendResponse(res, 200, true, 'Payments retrieved successfully', result.data, meta);
  }
);

/**
 * Updates a payment's status (and optional stellarTxHash).
 * Requires auth and ADMIN / SUPER_ADMIN.
 *
 * @param req.params.id - Payment id.
 * @param req.body.status - New payment status.
 * @param req.body.stellarTxHash - Optional on-chain transaction hash.
 * @returns HTTP 200 with envelope `{ success, message, data }` containing the updated payment.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when the caller lacks ADMIN / SUPER_ADMIN.
 * @throws {AppError} 404 ERR_PAYMENT_NOT_FOUND — when the settlement does not exist.
 * @throws {AppError} 500 ERR_INTERNAL_SERVER_ERROR — when the status update fails.
 * @throws {AppError} 400 VALIDATION_ERROR — when params/body validation fails.
 */
export const updatePaymentStatusController = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const payment = await paymentsService.updatePaymentStatusService(req.params.id, req.body);
    sendResponse(res, 200, true, 'Payment status updated successfully', payment);
  }
);

/**
 * GET /api/settlements/:id — full settlement detail including escrowRelease.
 * GET settlement detail including escrow/release fields.
 * Requires authentication. Used by `GET /:id` on the payments/settlements router.
 *
 * @param req.params.id - Settlement id.
 * @returns HTTP 200 with envelope `{ success, message, data }` containing the settlement.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 404 ERR_PAYMENT_NOT_FOUND — when the settlement does not exist.
 * @throws {AppError} 400 VALIDATION_ERROR — when the id param is invalid.
 */
export const getSettlementByIdController = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const settlement = await paymentsService.getPaymentByIdService(req.params.id);
    sendResponse(res, 200, true, 'Settlement retrieved successfully', settlement);
  }
);

/**
 * POST /api/settlements/:id/dispute — transition status to DISPUTED.
 * Restricted to ADMIN / MANAGER at route level.
 * Transitions a settlement to DISPUTED with a required reason.
 * Requires auth and ADMIN / MANAGER.
 *
 * @param req.params.id - Settlement id.
 * @param req.body.reason - Required dispute reason.
 * @param req.body.notes - Optional additional notes.
 * @returns HTTP 200 with envelope `{ success, message, data }` containing the disputed settlement.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when the caller lacks ADMIN / MANAGER.
 * @throws {AppError} 404 ERR_PAYMENT_NOT_FOUND — when the settlement does not exist.
 * @throws {AppError} 500 ERR_INTERNAL_SERVER_ERROR — when the dispute update fails.
 * @throws {AppError} 400 VALIDATION_ERROR — when params/body validation fails.
 */
export const disputeSettlementController = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const settlement = await paymentsService.disputeSettlementService(req.params.id, req.body);
    sendResponse(res, 200, true, 'Settlement disputed successfully', settlement);
  }
);

/**
 * GET /api/settlements/summary — aggregated totals + sparkline.
 * Returns aggregated settlement totals and sparkline for a period.
 * Requires authentication.
 *
 * @param req.query.period - Aggregation window: `week` | `month` | `quarter` (default `week`).
 * @returns HTTP 200 with envelope `{ success, message, data }` containing summary totals and sparkline.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 400 ERR_BAD_REQUEST — when period is not week/month/quarter.
 * @throws {AppError} 400 VALIDATION_ERROR — when query validation fails.
 */
export const getSettlementSummaryController = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const period = (req.query as Record<string, string>).period ?? 'week';
    const summary = await getSettlementSummaryService(req.user?.organizationId ?? '', period);
    sendResponse(res, 200, true, 'Settlement summary retrieved successfully', summary);
  }
);
