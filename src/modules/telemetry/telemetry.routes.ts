import { Router } from 'express';
import { asyncHandler } from '../../shared/http/asyncHandler.js';
import { validateRequest } from '../../shared/validation/validate.js';
import { getTelemetry, bulkIngest, getThresholds } from './telemetry.controller.js';
import { TelemetryQuerySchema, BulkTelemetryBodySchema } from './telemetry.validation.js';
import { requireAuth } from '../../shared/middleware/requireAuth.js';

export const telemetryRouter = Router();

telemetryRouter.get(
  '/thresholds',
  requireAuth,
  asyncHandler(getThresholds)
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
