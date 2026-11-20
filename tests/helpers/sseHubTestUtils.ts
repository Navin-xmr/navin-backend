import type { RealtimeEvent } from '../../src/shared/types/realtimeEvents.js';
import { publishToUser } from '../../src/infra/sse/sseHub.js';
import { sseHubState } from '../../src/infra/sse/sseHubState.js';

/**
 * Test-only helper to count active SSE connections.
 * @param userId - Optional user ID to count connections for a specific user
 * @returns Total number of SSE clients (all users or specific user)
 */
export function getSseClientCount(userId?: string): number {
  if (userId) {
    return sseHubState.clientsByUser.get(userId)?.size ?? 0;
  }

  let total = 0;
  for (const clients of sseHubState.clientsByUser.values()) {
    total += clients.size;
  }
  return total;
}

/**
 * Test-only helper to publish a realtime event to a user's SSE connections.
 * Wraps the production publishToUser for test scenarios.
 * @param userId - Target user ID
 * @param event - Realtime event to deliver
 */
export function deliverToUserForTest(userId: string, event: RealtimeEvent): void {
  publishToUser(userId, event);
}

/**
 * Test-only helper to check Redis pub/sub readiness.
 * @returns true if Redis pub/sub is initialized and ready
 */
export function isRedisPubSubReady(): boolean {
  return sseHubState.redisPubSubReady;
}

/**
 * Test-only helper to reset SSE hub state between tests.
 * Clears all active connections, timers, and Redis pub/sub state.
 * Called automatically in tests/setup.ts afterEach hook.
 */
export function resetSseHubForTest(): void {
  for (const clients of sseHubState.clientsByUser.values()) {
    for (const client of clients) {
      clearInterval(client.heartbeatTimer);
    }
  }
  sseHubState.clientsByUser.clear();
  sseHubState.redisPubSubReady = false;
  sseHubState.subscriber = null;
  sseHubState.publisher = null;
}
