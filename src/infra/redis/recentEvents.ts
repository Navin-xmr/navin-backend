/**
 * Redis-backed recent-events store for the polling fallback endpoint.
 *
 * Events are stored in a Redis LIST (key `recent_events`) as JSON strings.
 * Each entry carries a `publishedAt` epoch-ms field so consumers can filter
 * by time window. The list is capped at MAX_EVENTS entries; entries older
 * than TTL_MS are discarded during every push operation so memory stays
 * bounded even under high-throughput conditions.
 *
 * Usage
 * -----
 * - Call `pushRecentEvent()` whenever a real-time event is emitted.
 * - Call `getRecentEventsSince()` from the polling service to retrieve
 *   events newer than the caller's `since` timestamp.
 */

import { getRedisClient } from './connection.js';
import { logger } from '../../shared/logger/logger.js';
import type { RealtimeEvent } from '../../modules/events/events.types.js';

/** Maximum number of entries retained in the list. */
const MAX_EVENTS = 500;

/** Events older than this window are eligible for eviction on every push. */
const TTL_MS = 60_000;

/** Redis list key. */
const RECENT_EVENTS_KEY = 'recent_events';

/**
 * Pushes a RealtimeEvent into the recent-events Redis list and trims the list
 * to MAX_EVENTS entries.  Entries outside the TTL_MS window are also removed.
 *
 * This function is fire-and-forget safe: it logs errors internally and does
 * not throw, so a Redis failure never disrupts the primary emit path.
 */
export async function pushRecentEvent(event: RealtimeEvent): Promise<void> {
  try {
    const client = getRedisClient();
    const serialised = JSON.stringify(event);

    // Atomic pipeline: push → cap list → remove stale entries in one round-trip.
    const pipeline = client.pipeline();
    pipeline.lpush(RECENT_EVENTS_KEY, serialised);
    pipeline.ltrim(RECENT_EVENTS_KEY, 0, MAX_EVENTS - 1);
    await pipeline.exec();

    // Remove stale entries (older than TTL_MS) from the tail of the list.
    // We read the last element and keep trimming until the tail is within window.
    const cutoff = Date.now() - TTL_MS;
    let tail = await client.lindex(RECENT_EVENTS_KEY, -1);
    while (tail !== null) {
      const parsed = JSON.parse(tail) as RealtimeEvent;
      if (parsed.publishedAt < cutoff) {
        // Remove the rightmost element and check the next one.
        await client.rpop(RECENT_EVENTS_KEY);
        tail = await client.lindex(RECENT_EVENTS_KEY, -1);
      } else {
        break;
      }
    }
  } catch (err) {
    logger.error(err, 'recentEvents: failed to push event to Redis');
  }
}

/**
 * Returns all RealtimeEvents whose `publishedAt` is strictly greater than
 * `sinceMs` (epoch milliseconds).
 *
 * Reads the entire capped list from Redis — bounded at MAX_EVENTS entries —
 * and filters in-process.  For the default 15-second window this is fast and
 * avoids a Lua script dependency.
 *
 * @throws Rethrows any Redis connection or command error so the service layer
 *   can convert it to a structured `AppError`.
 */
export async function getRecentEventsSince(sinceMs: number): Promise<RealtimeEvent[]> {
  // NOTE: no try/catch here — Redis errors propagate to the caller (pollEventsSince)
  // which converts them to AppError(502, ERR_EVENTS_POLL_FAILED).
  const client = getRedisClient();
  const raw = await client.lrange(RECENT_EVENTS_KEY, 0, -1);

  const events: RealtimeEvent[] = [];
  for (const item of raw) {
    try {
      const event = JSON.parse(item) as RealtimeEvent;
      if (event.publishedAt > sinceMs) {
        events.push(event);
      }
    } catch {
      // Skip malformed entries silently — a bad JSON entry should not abort the read.
    }
  }

  // Events were pushed newest-first (lpush); reverse so consumers get them oldest-first.
  return events.reverse();
}
