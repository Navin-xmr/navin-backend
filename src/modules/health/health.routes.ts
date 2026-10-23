import { Router } from 'express';
import { asyncHandler } from '../../shared/http/asyncHandler.js';
import { healthController } from './health.controller.js';

export const healthRouter = Router();

// PUBLIC: liveness/readiness probe consumed by orchestrators, load balancers and
// uptime monitors, which cannot present a JWT. Exposes service status only — no
// user data, no configuration values.
healthRouter.get('/', asyncHandler(healthController));
