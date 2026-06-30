import type { FilterQuery } from 'mongoose';
import { AuditLog, type IAuditLog } from './auditLogs.model.js';

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

  if (userId) {
    baseQuery.userId = userId;
  }

  if (action) {
    baseQuery.action = action;
  }

  if (resource) {
    baseQuery.resource = resource;
  }

  if (from || to) {
    const range: { $gte?: Date; $lte?: Date } = {};
    if (from) {
      range.$gte = from;
    }
    if (to) {
      range.$lte = to;
    }
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

  return {
    data: data as IAuditLog[],
    nextCursor,
    hasMore,
    total,
  };
}
