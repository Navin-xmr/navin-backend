import type { RealtimeEvent } from '../../src/shared/types/realtimeEvents.js';

export interface SseHubTestHooks {
  getSseClientCount: (userId?: string) => number;
  deliverToUserForTest: (userId: string, event: RealtimeEvent) => void;
  isRedisPubSubReady: () => boolean;
  resetSseHubForTest: () => void;
}

const SSE_HUB_TEST_HOOKS_SYMBOL = Symbol.for('navin.sseHub.testHooks');

function getHooks(): SseHubTestHooks | undefined {
  return (globalThis as Record<symbol, SseHubTestHooks | undefined>)[SSE_HUB_TEST_HOOKS_SYMBOL];
}

export function getSseClientCount(userId?: string): number {
  return getHooks()?.getSseClientCount(userId) ?? 0;
}

export function deliverToUserForTest(userId: string, event: RealtimeEvent): void {
  getHooks()?.deliverToUserForTest(userId, event);
}

export function isRedisPubSubReady(): boolean {
  return getHooks()?.isRedisPubSubReady() ?? false;
}

export function resetSseHubForTest(): void {
  getHooks()?.resetSseHubForTest();
}
