/**
 * Exposure of the Prometheus registry (#1044).
 *
 * Secure by default: when `METRICS_TOKEN` is unset the endpoint does not exist (404) — metrics
 * are never served unauthenticated. When set, scrapers must send `Authorization: Bearer <token>`
 * (compared in constant time).
 *
 * The API serves `GET /api/metrics`; worker processes (separate registries) opt in with
 * `METRICS_PORT` and serve `GET /metrics` on that port.
 */
import { createServer, type Server } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

import { config } from '../../config/index.js';
import { logger } from '../../shared/logger/logger.js';
import { getTransactionQueue } from '../redis/queue.js';
import { metricsRegistry, setQueueDepthProvider } from './chainMetrics.js';

/** Depth of the transaction queue, evaluated on each scrape (bounded labels: see chainMetrics). */
export function registerTransactionQueueDepth(): void {
  setQueueDepthProvider(async () => {
    const counts = await getTransactionQueue().getJobCounts(
      'waiting',
      'active',
      'delayed',
      'failed'
    );
    return { transaction_queue: counts };
  });
}

function tokenMatches(header: string | undefined, token: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const digest = (v: string) => createHash('sha256').update(v).digest();
  return timingSafeEqual(digest(header.slice(7)), digest(token));
}

/** Express handler for `GET /api/metrics`. */
export const metricsHandler: RequestHandler = async (req, res) => {
  const token = config.metricsToken;
  if (!token) {
    res.status(404).json({ success: false, message: 'Not found', data: null });
    return;
  }
  if (!tokenMatches(req.headers.authorization, token)) {
    res.status(401).json({ success: false, message: 'Unauthorized', data: null });
    return;
  }
  registerTransactionQueueDepth();
  res.setHeader('Content-Type', metricsRegistry.contentType);
  res.end(await metricsRegistry.metrics());
};

/** Starts the scrape listener for a worker process; no-op unless `METRICS_PORT` and `METRICS_TOKEN` are set. */
export function startMetricsServer(): Server | undefined {
  const port = config.metricsPort;
  if (!port || !config.metricsToken) return undefined;
  registerTransactionQueueDepth();
  const server = createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== '/metrics') {
      res.statusCode = 404;
      res.end();
      return;
    }
    if (!tokenMatches(req.headers.authorization, config.metricsToken as string)) {
      res.statusCode = 401;
      res.end();
      return;
    }
    metricsRegistry
      .metrics()
      .then(body => {
        res.setHeader('Content-Type', metricsRegistry.contentType);
        res.end(body);
      })
      .catch(() => {
        res.statusCode = 500;
        res.end();
      });
  });
  server.on('error', err => logger.error({ err }, 'Metrics server error'));
  server.listen(port, () => logger.info({ port }, 'Metrics server listening'));
  return server;
}
