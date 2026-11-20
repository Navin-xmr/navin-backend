import '../loadEnv.js';
import { pathToFileURL } from 'node:url';
import { config } from '../config/index.js';
import { connectMongo, disconnectMongo } from '../infra/mongo/connection.js';
import { logger } from '../shared/logger/logger.js';
import { replayIndexerDeadLetters } from '../workers/stellar-indexer.worker.js';

async function replay(): Promise<void> {
  await connectMongo(config.mongoUri);
  try {
    const summary = await replayIndexerDeadLetters();
    logger.info(summary, 'Indexer dead-letter replay complete');
    if (summary.failed > 0) process.exitCode = 1;
  } finally {
    await disconnectMongo();
  }
}

const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  replay().catch(err => {
    logger.error({ err }, 'Indexer dead-letter replay failed');
    process.exitCode = 1;
  });
}