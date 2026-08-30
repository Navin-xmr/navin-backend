import type { RequestHandler } from 'express';

import type { PollQuery } from './events.validation.js';
import { pollEventsSince, subscribeUserToEvents } from './events.service.js';
import { sendResponse } from '../../shared/http/sendResponse.js';
import { AppError, ErrorCodes } from '../../shared/http/errors.js';

/**
 * Returns real-time events that occurred after the `since` timestamp.
 * Route: `GET /api/events/poll`. Requires JWT auth (`requireAuth`).
 * Returns an empty array when the client is already up to date.
 * The `since` field has already been coerced to a Date by the Zod schema.
 *
 * @param req.query.since - ISO timestamp; only events after this instant are returned.
 * @returns HTTP 200 with envelope `{ success, message, data }` where data is `RealtimeEvent[]`.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 400 VALIDATION_ERROR — when `since` is missing or invalid.
 * @throws {AppError} 502 ERR_EVENTS_POLL_FAILED — when the Redis event store read fails.
 */
export const pollEventsController: RequestHandler = async (req, res) => {
  const { since } = req.query as unknown as PollQuery;
  const events = await pollEventsSince(since);
  sendResponse(res, 200, true, 'Events retrieved', events);
};

/**
 * Streams Server-Sent Events for the authenticated user.
 * Route: `GET /api/events/` (SSE). Authenticated via `requireSseAuth`.
 * Response uses `text/event-stream` and is not wrapped in the standard JSON envelope.
 *
 * @returns Long-lived `text/event-stream` connection until the client disconnects.
 * @throws {AppError} 401 UNAUTHORIZED — when the user id is missing from the auth context.
 */
export const streamEventsController: RequestHandler = (req, res) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw new AppError(401, 'Missing or invalid authorization token', ErrorCodes.UNAUTHORIZED);
  }

  subscribeUserToEvents(userId, res);
};
