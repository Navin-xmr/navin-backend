import { Router } from 'express';
import { asyncHandler } from '../../shared/http/asyncHandler.js';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import { requireRole } from '../../shared/middleware/requireRole.js';
import { validateRequest } from '../../shared/validation/validate.js';
import { getAnomalies, resolveAnomaly, getAnomalyStats } from './anomaly.controller.js';
import {
  AnomalyQuerySchema,
  ResolveAnomalyParamsSchema,
  ResolveAnomalyBodySchema,
} from './anomaly.validation.js';

import { UserRole } from '../../shared/constants/index.js';

export const anomaliesRouter = Router();

/**
 * Route-role metadata for the anomaly module.
 * Single source of truth — imported by tests/rbac.matrix.test.ts (TODO G6).
 */
export const routeRoles = {
  'GET /api/anomalies': [UserRole.ADMIN, UserRole.MANAGER],
  'PATCH /api/anomalies/:id/resolve': [UserRole.ADMIN, UserRole.MANAGER],
} as const;

anomaliesRouter.get(
  '/stats',
  requireAuth,
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(getAnomalyStats)
);

anomaliesRouter.get(
  '/',
  requireAuth,
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  validateRequest({ query: AnomalyQuerySchema }),
  asyncHandler(getAnomalies)
);

anomaliesRouter.patch(
  '/:id/resolve',
  requireAuth,
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  validateRequest({ params: ResolveAnomalyParamsSchema, body: ResolveAnomalyBodySchema }),
  asyncHandler(resolveAnomaly)
);
