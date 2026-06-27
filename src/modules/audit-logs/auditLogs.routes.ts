import { Router } from 'express';
import { asyncHandler } from '../../shared/http/asyncHandler.js';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import { requireRole } from '../../shared/middleware/requireRole.js';
import { validateRequest } from '../../shared/validation/validate.js';
import { UserRole } from '../../shared/constants/index.js';
import { getAuditLogs } from './auditLogs.controller.js';
import { AuditLogsQuerySchema } from './auditLogs.validation.js';

export const auditLogsRouter = Router();

auditLogsRouter.get(
  '/',
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN),
  validateRequest({ query: AuditLogsQuerySchema }),
  asyncHandler(getAuditLogs)
);
