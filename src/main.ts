import './loadEnv.js';

import { createServer } from 'http';
import { buildApp } from './app.js';
import { config } from './config/index.js';
import { connectMongo, disconnectMongo } from './infra/mongo/connection.js';
import { disconnectRedis } from './infra/redis/connection.js';
import { initSocketIO, closeSocketIO } from './infra/socket/io.js';
import { initSseHub, closeSseHub } from './infra/sse/sseHub.js';
import { startAlertWorker } from './workers/alert.worker.js';
import { startMaintenanceWorker, scheduleMaintenanceJobs } from './workers/maintenance.worker.js';
import { logger } from './shared/logger/logger.js';

async function main() {
  await connectMongo(config.mongoUri);

  const app = buildApp();
  const httpServer = createServer(app);
  initSocketIO(httpServer);
  await initSseHub();
  const alertWorker = startAlertWorker();
  const maintenanceWorker = startMaintenanceWorker();

  // Schedule recurring maintenance jobs
  await scheduleMaintenanceJobs();

  httpServer.listen(config.port, () => {
    logger.info({ port: config.port }, 'HTTP server listening');
  });

  function shutdown(signal: string) {
    logger.info({ signal }, 'Shutdown signal received');

    const forceExit = setTimeout(() => {
      logger.error('Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 30_000);
    forceExit.unref();

    httpServer.close(async () => {
      try {
        await alertWorker.close();
        await maintenanceWorker.close();
        await closeSocketIO();
        await closeSseHub();
        await disconnectRedis();
        await disconnectMongo();
        logger.info('Graceful shutdown complete');
        process.exit(0);
      } catch (err) {
        logger.error({ err }, 'Error during shutdown');
        process.exit(1);
      }
    });
  }

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

main().catch(err => {
  logger.error({ err }, 'Failed to start application');
  process.exit(1);
});
