import type { Response } from 'express';

import { getRecentEventsSince } from '../../infra/redis/recentEvents.js';
import { registerSseClient } from '../../infra/sse/sseHub.js';
import { AppError, ErrorCodes } from '../../shared/http/errors.js';
import type { RealtimeEvent } from './events.types.js';

/**
 * Returns all real-time events that occurred after `since`.
 *
 * Delegates to the Redis recent-events store.  Returns an empty array when no
 * events are available — this is the expected happy-path for an up-to-date client.
 *
 * @param since - Only events with publishedAt > since.getTime() are returned.
 * @throws {AppError} ERR_EVENTS_POLL_FAILED (502) when the Redis read fails.
 */
export async function pollEventsSince(since: Date): Promise<RealtimeEvent[]> {
  try {
    return await getRecentEventsSince(since.getTime());
  } catch (err) {
    throw new AppError(
      502,
      'Failed to retrieve recent events from the event store',
      ErrorCodes.EVENTS_POLL_FAILED,
      err
    );
  }
}

/**
 * Opens a user-scoped SSE stream. The connection stays open until the client disconnects.
 */
export function subscribeUserToEvents(userId: string, res: Response): void {
  registerSseClient(userId, res);
}
