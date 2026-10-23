/**
 * Stops the shared MongoDB Memory Server started in `tests/globalSetup.ts`.
 *
 * NOTE: Jest loads this hook through a CJS `require` pipeline, so this file
 * must not use ESM `.js`-suffixed relative imports (e.g. `../src/...js`) —
 * they fail to resolve here. It only touches `globalThis`, which needs no
 * imports at all. Per-file Redis/mongoose/SSE/socket handles are released in
 * `tests/setup.ts` inside each worker.
 */
export default async function globalTeardown(): Promise<void> {
  console.log('[Global Teardown] Starting cleanup...');

  try {
    const server = (globalThis as Record<string, unknown>).__MONGO_MEMORY_SERVER__ as
      | { stop: () => Promise<unknown> }
      | undefined;
    if (server) {
      await server.stop();
      console.log('[Global Teardown] Stopped shared MongoDB Memory Server');
    } else {
      console.log('[Global Teardown] No shared MongoDB Memory Server to stop');
    }
  } catch (error) {
    console.error('[Global Teardown] Error stopping MongoDB Memory Server:', error);
  }

  console.log('[Global Teardown] Cleanup complete');
}
