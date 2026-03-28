import { Router } from 'express';
import { asyncHandler } from '../../shared/http/asyncHandler.js';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import { requireRole } from '../../shared/middleware/requireRole.js';
import { getAnomalies, resolveAnomaly } from './anomaly.controller.js';

export const anomaliesRouter = Router();

anomaliesRouter.get(
  '/',
  requireAuth,
  requireRole('ADMIN', 'MANAGER'),
  asyncHandler(getAnomalies)
);

anomaliesRouter.patch(
  '/:id/resolve',
  requireAuth,
  requireRole('ADMIN', 'MANAGER'),
  asyncHandler(resolveAnomaly)
);
