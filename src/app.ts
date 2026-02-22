import express from 'express';
import cors from 'cors';

import { requestId } from './shared/middleware/requestId.js';
import { notFound } from './shared/middleware/notFound.js';
import { errorMiddleware } from './shared/http/errorMiddleware.js';

import { healthRouter } from './modules/health/health.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';

export function buildApp() {
  const app = express();

  app.use(requestId());
  app.use(cors());
  app.use(express.json());

  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/shipments', require('./modules/shipments/shipments.routes').default);

  app.use(notFound());
  app.use(errorMiddleware());

  return app;
}
