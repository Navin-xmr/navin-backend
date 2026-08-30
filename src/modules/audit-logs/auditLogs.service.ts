import type { FilterQuery } from 'mongoose';
import { AuditLog, type IAuditLog } from './auditLogs.model.js';

export interface GetActivityParams {
  before?: string;
  limit: number;
  userId?: string;
  action?: string;
  resource?: string;
}

export interface GetActivityResult {
  data: IAuditLog[];
  total: number;
  hasMore: boolean;
  before: string | null;
}

/**
 * Retrieves activity feed entries using before-based (ISO date) pagination.
 * Events are ordered newest-first. Passing `before` returns only events
 * whose timestamp is strictly older than the supplied ISO date.
 *
 * @param {GetActivityParams} params - Query parameters.
 * @returns {Promise<GetActivityResult>} Paginated activity entries with meta.
 */
export async function getActivityService(params: GetActivityParams): Promise<GetActivityResult> {
  const { before, limit, userId, action, resource } = params;

  const baseQuery: FilterQuery<unknown> = {};

  if (userId) {
    baseQuery.userId = userId;
  }

  if (action) {
    baseQuery.action = action;
  }

  if (resource) {
    baseQuery.resource = resource;
  }

  // before-based page filter: fetch events strictly older than the cursor date
  const pageQuery: FilterQuery<unknown> = { ...baseQuery };
  if (before) {
    pageQuery.timestamp = { $lt: new Date(before) };
  }

  const [logs, total] = await Promise.all([
    AuditLog.find(pageQuery)
      .sort({ timestamp: -1, _id: -1 })
      .limit(limit + 1)
      .lean(),
    AuditLog.countDocuments(baseQuery),
  ]);

  const hasMore = logs.length > limit;
  const data = hasMore ? logs.slice(0, limit) : logs;

  // next `before` value is the timestamp of the oldest item in this page
  const nextBefore =
    hasMore && data.length > 0 ? (data[data.length - 1].timestamp as Date).toISOString() : null;

  return {
    data: data as IAuditLog[],
    total,
    hasMore,
    before: nextBefore,
  };
}

// ── Legacy service kept for backward-compat /api/audit-logs ──────────────────

export interface GetAuditLogsParams {
  cursor?: string;
  limit: number;
  userId?: string;
  action?: string;
  resource?: string;
  from?: Date;
  to?: Date;
}

export interface GetAuditLogsResult {
  data: IAuditLog[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;
}

export async function getAuditLogsService(params: GetAuditLogsParams): Promise<GetAuditLogsResult> {
  const { cursor, limit, userId, action, resource, from, to } = params;

  const baseQuery: FilterQuery<unknown> = {};

  if (userId) baseQuery.userId = userId;
  if (action) baseQuery.action = action;
  if (resource) baseQuery.resource = resource;

  if (from || to) {
    const range: { $gte?: Date; $lte?: Date } = {};
    if (from) range.$gte = from;
    if (to) range.$lte = to;
    baseQuery.timestamp = range;
  }

  const query = { ...baseQuery };
  if (cursor) {
    query._id = { $lt: cursor };
  }

  const [logs, total] = await Promise.all([
    AuditLog.find(query)
      .sort({ timestamp: -1, _id: -1 })
      .limit(limit + 1)
      .lean(),
    AuditLog.countDocuments(baseQuery),
  ]);

  const hasMore = logs.length > limit;
  const data = hasMore ? logs.slice(0, limit) : logs;
  const nextCursor = hasMore && data.length > 0 ? data[data.length - 1]._id.toString() : null;

  return { data: data as IAuditLog[], nextCursor, hasMore, total };
}
