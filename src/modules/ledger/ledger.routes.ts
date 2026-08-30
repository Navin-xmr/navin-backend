import { Router } from 'express';
import { asyncHandler } from '../../shared/http/asyncHandler.js';
import { validateRequest } from '../../shared/validation/validate.js';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import { requireRole } from '../../shared/middleware/requireRole.js';
import { UserRole } from '../../shared/constants/index.js';
import { GetLedgerBlocksQuerySchema, LedgerBlockIdParamSchema } from './ledger.validation.js';
import { getLedgerBlocks, getLedgerBlockById } from './ledger.controller.js';

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
