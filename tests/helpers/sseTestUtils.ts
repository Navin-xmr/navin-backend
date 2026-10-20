import type { RealtimeEvent } from '../../src/shared/types/realtimeEvents.js';
import { sseHubState } from '../../src/infra/sse/sseHubState.js';

function formatSseMessage(event: RealtimeEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Returns the number of registered SSE clients for `userId`, or the total across
 * all users when `userId` is omitted.
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
 * Bypasses Redis pub/sub to write a realtime event directly to local SSE clients
 * during unit tests.
 */
export function deliverToUserForTest(userId: string, event: RealtimeEvent): void {
  const clients = sseHubState.clientsByUser.get(userId);
  if (!clients || clients.size === 0) {
    return;
  }

  const payload = formatSseMessage(event);
  for (const client of clients) {
    if (!client.res.writableEnded) {
      client.res.write(payload);
    }
  }
}

/** Reports whether the SSE hub's Redis pub/sub bridge is marked ready. */
export function isRedisPubSubReady(): boolean {
  return sseHubState.redisPubSubReady;
}

/** Clears all registered SSE clients, heartbeat timers, and Redis pub/sub state. */
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
