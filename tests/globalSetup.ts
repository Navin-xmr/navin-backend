import { MongoMemoryServer } from 'mongodb-memory-server';

/**
 * Starts ONE MongoDB Memory Server for the whole Jest run and publishes its
 * URI via `process.env.MONGO_URI` (workers are forked after this completes,
 * so every test file sees it). Per-file servers in `tests/setup.ts` are only
 * a fallback when this file is bypassed.
 *
 * The instance is stashed on `globalThis` (same main process) for
 * `tests/globalTeardown.ts` to stop. Set `SKIP_MONGO_MEMORY=1` to skip
 * entirely (fully mocked unit runs / no MMS binary).
 */
export default async function globalSetup(): Promise<void> {
  if (process.env.SKIP_MONGO_MEMORY === '1') {
    return;
  }

  const server = await MongoMemoryServer.create({
    binary: { checkMD5: false },
  });
  process.env.MONGO_URI = server.getUri();
  process.env.MONGO_MEMORY_SHARED = '1';
  (globalThis as Record<string, unknown>).__MONGO_MEMORY_SERVER__ = server;
}
