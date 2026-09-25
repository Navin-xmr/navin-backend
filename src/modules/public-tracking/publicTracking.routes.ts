import { Router } from 'express';
import { asyncHandler } from '../../shared/http/asyncHandler.js';
import { validateRequest } from '../../shared/validation/validate.js';
import { getPublicTrackingController } from './publicTracking.controller.js';
import { PublicTrackingParamSchema } from './publicTracking.validation.js';

export const publicTrackingRouter = Router();

publicTrackingRouter.get(
  '/:trackingNumber',
  validateRequest({ params: PublicTrackingParamSchema }),
  asyncHandler(getPublicTrackingController)
);

export default publicTrackingRouter;
