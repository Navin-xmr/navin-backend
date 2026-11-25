import { Router } from 'express';
import { asyncHandler } from '../../shared/http/asyncHandler.js';
import { validateRequest } from '../../shared/validation/validate.js';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import { requireRole } from '../../shared/middleware/requireRole.js';
import { UserRole } from '../../shared/constants/index.js';
import {
  GetLedgerBlocksQuerySchema,
  LedgerBlockIdParamSchema,
  ChainShipmentStatusParamSchema,
  ChainPaymentIdParamSchema,
} from './ledger.validation.js';
import {
  getLedgerBlocks,
  getLedgerBlockById,
  getLedgerBlockVerification,
  getEscrowBalanceController,
  getShipmentStatusController,
  getSettlementRecordController,
  getContractVersionController,
} from './ledger.controller.js';

export const ledgerRouter = Router();

ledgerRouter.use(requireAuth);

ledgerRouter.get(
  '/blocks',
  requireRole(UserRole.ADMIN, UserRole.MANAGER, UserRole.VIEWER),
  validateRequest({ query: GetLedgerBlocksQuerySchema }),
  asyncHandler(getLedgerBlocks)
);

ledgerRouter.get(
  '/blocks/:id',
  requireRole(UserRole.ADMIN, UserRole.MANAGER, UserRole.VIEWER),
  validateRequest({ params: LedgerBlockIdParamSchema }),
  asyncHandler(getLedgerBlockById)
);

ledgerRouter.get(
  '/blocks/:id/verification',
  requireRole(UserRole.ADMIN, UserRole.MANAGER, UserRole.VIEWER),
  validateRequest({ params: LedgerBlockIdParamSchema }),
  asyncHandler(getLedgerBlockVerification)
);

// ─── Chain read endpoints (P14-12) ───
// Simulation-only, short-TTL cached reads. Role-guarded per AGENTS §4.

ledgerRouter.get(
  '/chain/shipment-status/:shipmentId',
  requireRole(UserRole.ADMIN, UserRole.MANAGER, UserRole.VIEWER),
  validateRequest({ params: ChainShipmentStatusParamSchema }),
  asyncHandler(getShipmentStatusController)
);

ledgerRouter.get(
  '/chain/escrow-balance/:paymentId',
  requireRole(UserRole.ADMIN, UserRole.MANAGER, UserRole.VIEWER),
  validateRequest({ params: ChainPaymentIdParamSchema }),
  asyncHandler(getEscrowBalanceController)
);

ledgerRouter.get(
  '/chain/settlement-record/:paymentId',
  requireRole(UserRole.ADMIN, UserRole.MANAGER, UserRole.VIEWER),
  validateRequest({ params: ChainPaymentIdParamSchema }),
  asyncHandler(getSettlementRecordController)
);

ledgerRouter.get(
  '/chain/contract-version',
  requireRole(UserRole.ADMIN, UserRole.MANAGER, UserRole.VIEWER),
  asyncHandler(getContractVersionController)
);
