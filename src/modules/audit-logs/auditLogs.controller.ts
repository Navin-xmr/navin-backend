import type { Request, Response } from 'express';
import { sendResponse } from '../../shared/http/sendResponse.js';
import type { ActivityQuery, AuditLogsQuery } from './auditLogs.validation.js';
import { getActivityService, getAuditLogsService } from './auditLogs.service.js';

/**
 * Returns a paginated activity feed for the organization.
 * Route: `GET /api/activity`. Requires auth and ADMIN / MANAGER / VIEWER.
 * Pagination is before-based: pass `before` as an ISO 8601 date string to fetch
 * events older than that timestamp.
 *
 * @param req.query.before - Optional ISO timestamp; return events older than this.
 * @param req.query.limit - Page size (default 20).
 * @param req.query.userId - Optional actor user filter.
 * @param req.query.action - Optional action filter.
 * @param req.query.resource - Optional resource filter.
 * @returns HTTP 200 with envelope `{ success, message, data, meta }` (`limit`, `total`, `hasMore`, `before`).
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when the caller lacks ADMIN / MANAGER / VIEWER.
 * @throws {AppError} 400 VALIDATION_ERROR — when query validation fails.
 */
export const getActivity = async (req: Request, res: Response) => {
  const query = req.query as unknown as ActivityQuery;

  const result = await getActivityService({
    before: query.before,
    limit: query.limit ?? 20,
    userId: query.userId,
    action: query.action,
    resource: query.resource,
  });

  sendResponse(res, 200, true, 'Activity retrieved', result.data, {
    limit: query.limit ?? 20,
    total: result.total,
    hasMore: result.hasMore,
    before: result.before,
  });
};

/**
 * Lists audit log entries with optional filters and cursor pagination.
 * Route: `GET /api/audit-logs` (legacy — ADMIN / SUPER_ADMIN only).
 * Prefer `/api/activity` for new integrations.
 *
 * @param req.query.cursor - Optional cursor for the next page.
 * @param req.query.limit - Page size (default 20, max 100).
 * @param req.query.userId - Optional actor user filter.
 * @param req.query.action - Optional action filter.
 * @param req.query.resource - Optional resource filter.
 * @param req.query.from - Optional start of time window.
 * @param req.query.to - Optional end of time window.
 * @returns HTTP 200 with envelope `{ success, message, data, meta }` (`nextCursor`, `hasMore`, `total`).
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when the caller lacks SUPER_ADMIN / ADMIN.
 * @throws {AppError} 400 VALIDATION_ERROR — when query validation fails.
 */
export const getAuditLogs = async (req: Request, res: Response) => {
  const query = req.query as unknown as AuditLogsQuery;

  const result = await getAuditLogsService({
    cursor: query.cursor,
    limit: query.limit ?? 20,
    userId: query.userId,
    action: query.action,
    resource: query.resource,
    from: query.from,
    to: query.to,
  });

  sendResponse(res, 200, true, 'Audit logs retrieved', result.data, {
    nextCursor: result.nextCursor,
    hasMore: result.hasMore,
    total: result.total,
  });
};
