import { z } from 'zod';

/**
 * Query-string schema for GET /api/events/poll.
 *
 * `since` — ISO 8601 UTC string representing the client's last-poll timestamp.
 *   Defaults to 15 seconds ago when omitted so first-time callers get a
 *   sensible initial window without having to track state.
 *
 * Coerced to a Date so the service layer receives a proper Date object.
 */
export const PollQuerySchema = z.object({
  since: z
    .string()
    .datetime({ message: 'since must be a valid ISO 8601 UTC datetime string' })
    .optional()
    .transform(val => (val !== undefined ? new Date(val) : new Date(Date.now() - 15_000))),
});

export type PollQuery = z.infer<typeof PollQuerySchema>;
