import { Router } from 'express';
import { asyncHandler } from '../../shared/http/asyncHandler.js';
import { validateRequest } from '../../shared/validation/validate.js';
import {
  getTelemetry,
  bulkIngest,
  getTelemetryThresholds,
  putTelemetryThresholds,
} from './telemetry.controller.js';
import {
  TelemetryQuerySchema,
  BulkTelemetryBodySchema,
  TelemetryThresholdsQuerySchema,
  UpdateTelemetryThresholdsBodySchema,
} from './telemetry.validation.js';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import { requireRole } from '../../shared/middleware/requireRole.js';
import { UserRole } from '../../shared/constants/index.js';

export const telemetryRouter = Router();

telemetryRouter.get(
  '/thresholds',
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER, UserRole.VIEWER),
  validateRequest({ query: TelemetryThresholdsQuerySchema }),
  asyncHandler(getTelemetryThresholds)
);

telemetryRouter.put(
  '/thresholds',
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN),
  validateRequest({ body: UpdateTelemetryThresholdsBodySchema }),
  asyncHandler(putTelemetryThresholds)
);

telemetryRouter.get(
  '/',
  requireAuth,
  validateRequest({ query: TelemetryQuerySchema }),
  asyncHandler(getTelemetry)
);

telemetryRouter.post(
  '/bulk',
  requireAuth,
  validateRequest({ body: BulkTelemetryBodySchema }),
  asyncHandler(bulkIngest)
);
