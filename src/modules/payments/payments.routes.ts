import { Router } from 'express';
import { validateRequest } from '../../shared/validation/validate.js';
import {
  CreatePaymentBodySchema,
  UpdatePaymentStatusBodySchema,
  PaymentIdParamSchema,
  GetPaymentsQuerySchema,
  DisputeSettlementBodySchema,
} from './payments.validation.js';
import {
  createPaymentController,
  getPaymentController,
  getPaymentsController,
  updatePaymentStatusController,
  getSettlementByIdController,
  disputeSettlementController,
  getSettlementSummaryController,
} from './payments.controller.js';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import { UserRole } from '../../shared/constants/index.js';
import { requireRole } from '../../shared/middleware/requireRole.js';
import { asyncHandler } from '../../shared/http/asyncHandler.js';
import { z } from 'zod';

export const paymentsRouter = Router();

const SummaryQuerySchema = z.object({
  period: z.enum(['week', 'month', 'quarter']).optional().default('week'),
});

// Require authentication for all payment/settlement routes
paymentsRouter.use(requireAuth);

// GET /summary — must be declared before /:id so Express doesn't swallow "summary" as an id
paymentsRouter.get(
  '/summary',
  validateRequest({ query: SummaryQuerySchema }),
  asyncHandler(getSettlementSummaryController)
);

paymentsRouter.post(
  '/',
  requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateRequest({ body: CreatePaymentBodySchema }),
  asyncHandler(createPaymentController)
);

paymentsRouter.get(
  '/',
  validateRequest({ query: GetPaymentsQuerySchema }),
  asyncHandler(getPaymentsController)
);

paymentsRouter.get(
  '/:id',
  validateRequest({ params: PaymentIdParamSchema }),
  asyncHandler(getSettlementByIdController)
);

paymentsRouter.patch(
  '/:id/status',
  requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateRequest({ params: PaymentIdParamSchema, body: UpdatePaymentStatusBodySchema }),
  asyncHandler(updatePaymentStatusController)
);

paymentsRouter.post(
  '/:id/dispute',
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  validateRequest({ params: PaymentIdParamSchema, body: DisputeSettlementBodySchema }),
  asyncHandler(disputeSettlementController)
);

// Keep the legacy getPaymentController export for backward-compat references
export { getPaymentController };
