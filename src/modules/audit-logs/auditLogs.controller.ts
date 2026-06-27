import type { Request, Response } from 'express';
import { sendResponse } from '../../shared/http/sendResponse.js';
import type { AuditLogsQuery } from './auditLogs.validation.js';
import { getAuditLogsService } from './auditLogs.service.js';

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
