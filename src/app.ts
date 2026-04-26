import express from 'express';

import { requestId } from './shared/middleware/requestId.js';
import { notFound } from './shared/middleware/notFound.js';
import { errorMiddleware } from './shared/http/errorMiddleware.js';
import { standardLimiter, strictLimiter } from './shared/middleware/rateLimiter.js';
import { corsMiddleware, corsPreflight } from './config/cors.js';

import { healthRouter } from './modules/health/health.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { shipmentsRouter } from './modules/shipments/shipments.routes.js';
import { webhooksRouter } from './modules/webhooks/iot.routes.js';
import { analyticsRouter } from './modules/analytics/analytics.routes.js';
import { anomaliesRouter } from './modules/anomaly/anomaly.routes.js';
import { telemetryRouter } from './modules/telemetry/telemetry.routes.js';

export function buildApp() {
  const app = express();

  app.use(requestId());
  app.use(corsMiddleware);
  app.options('*', corsPreflight);
  app.use(express.json());

  app.use(standardLimiter);
  app.use('/api/auth/login', strictLimiter);

  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/shipments', shipmentsRouter);
  app.use('/api/webhooks', webhooksRouter);
  app.use('/api/analytics', analyticsRouter);
  app.use('/api/anomalies', anomaliesRouter);
  app.use('/api/telemetry', telemetryRouter);

  app.use(notFound());
  app.use(errorMiddleware());

  return app;
}
