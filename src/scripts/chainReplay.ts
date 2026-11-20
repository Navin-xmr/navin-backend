/**
 * #1063 — replay chain events into the LedgerBlock projection from a ledger/event cursor.
 *
 *   npm run chain:replay -- --from <ledger|event-id> [--dry-run]
 *
 * - `--from` is a ledger sequence (Soroban adapter) or an event id (cursor).
 * - `--dry-run` reports counts and performs no writes.
 * - Safe to re-run: projection writes are upserts keyed on the transaction hash.
 * - Does not move the live indexer's stored cursor.
 */
import '../loadEnv.js';
import { pathToFileURL } from 'node:url';
import { config } from '../config/index.js';
import { connectMongo, disconnectMongo } from '../infra/mongo/connection.js';
import { disconnectRedis } from '../infra/redis/connection.js';
import { getChainAdapter } from '../services/chain/factory.js';
import {
  indexStellarTransactions,
  type IndexerSummary,
} from '../workers/stellar-indexer.worker.js';
import type { ChainAdapter } from '../services/chain/types.js';
import { logger } from '../shared/logger/logger.js';

export interface ReplayArgs {
  from: string;
  dryRun: boolean;
}

export function parseReplayArgs(argv: string[]): ReplayArgs {
  let from: string | undefined;
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--from') from = argv[(i += 1)];
    else if (arg.startsWith('--from=')) from = arg.slice('--from='.length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!from || from.startsWith('--')) {
    throw new Error('Usage: npm run chain:replay -- --from <ledger|event-id> [--dry-run]');
  }
  return { from, dryRun };
}

export async function runReplay(
  args: ReplayArgs,
  adapter: ChainAdapter = getChainAdapter()
): Promise<IndexerSummary> {
  return indexStellarTransactions(adapter, args.from, {
    dryRun: args.dryRun,
    persistCursor: false,
  });
}

const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  (async () => {
    const args = parseReplayArgs(process.argv.slice(2));
    await connectMongo(config.mongoUri);
    const summary = await runReplay(args);
    logger.info({ ...summary, dryRun: args.dryRun, from: args.from }, 'Chain replay complete');
    console.log(JSON.stringify({ dryRun: args.dryRun, from: args.from, ...summary }, null, 2));
  })()
    .catch(err => {
      logger.error({ err }, 'Chain replay failed');
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await disconnectMongo().catch(() => undefined);
      await disconnectRedis().catch(() => undefined);
    });
}
