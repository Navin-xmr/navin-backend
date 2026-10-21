import type { RealtimeEvent } from '../../src/shared/types/realtimeEvents.js';
import { publishToUser } from '../../src/infra/sse/sseHub.js';
import { sseHubState } from '../../src/infra/sse/sseHubState.js';

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

export function deliverToUserForTest(userId: string, event: RealtimeEvent): void {
  publishToUser(userId, event);
}

export function isRedisPubSubReady(): boolean {
  return sseHubState.redisPubSubReady;
}

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
