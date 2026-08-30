import { Router } from 'express';
import { asyncHandler } from '../../shared/http/asyncHandler.js';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import { requireRole } from '../../shared/middleware/requireRole.js';
import { validateRequest } from '../../shared/validation/validate.js';
import { UserRole } from '../../shared/constants/index.js';
import { getActivity, getAuditLogs } from './auditLogs.controller.js';
import { ActivityQuerySchema, AuditLogsQuerySchema } from './auditLogs.validation.js';

export const activityRouter = Router();

activityRouter.get(
  '/',
  asyncHandler(requireAuth),
  requireRole(UserRole.ADMIN, UserRole.MANAGER, UserRole.VIEWER, UserRole.SUPER_ADMIN),
  validateRequest({ query: ActivityQuerySchema }),
  asyncHandler(getActivity)
);

// ── Legacy router retained at /api/audit-logs ─────────────────────────────────

export const auditLogsRouter = Router();

auditLogsRouter.get(
  '/',
  asyncHandler(requireAuth),
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN),
  validateRequest({ query: AuditLogsQuerySchema }),
  asyncHandler(getAuditLogs)
);
