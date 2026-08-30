import type { Request, Response } from 'express';
import * as anomalyService from './anomaly.service.js';
import { sendResponse } from '../../shared/http/sendResponse.js';

/**
 * Lists anomalies with optional filters and cursor pagination.
 * Requires auth and ADMIN / MANAGER.
 *
 * @param req.query.cursor - Optional cursor for the next page.
 * @param req.query.limit - Page size (default 20).
 * @param req.query.shipmentId - Optional shipment filter.
 * @param req.query.severity - Optional severity filter.
 * @param req.query.type - Optional anomaly type filter.
 * @param req.query.resolved - Optional resolved flag (`true`/`false`).
 * @returns HTTP 200 with envelope `{ success, message, data, meta }` where meta is `{ nextCursor, hasMore }`.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when the caller lacks ADMIN / MANAGER.
 */
export const getAnomalies = async (req: Request, res: Response) => {
  const { cursor, limit = 20, shipmentId, severity, type, resolved } = req.query;

  const resolvedValue = typeof resolved === 'string' ? resolved === 'true' : undefined;

  const { data, nextCursor, hasMore } = await anomalyService.getAnomaliesService({
    cursor: cursor as string | undefined,
    limit: Number(limit),
    shipmentId: shipmentId as string | undefined,
    severity: severity as string | undefined,
    type: type as string | undefined,
    resolved: resolvedValue,
  });

  sendResponse(res, 200, true, 'Anomalies retrieved', data, { nextCursor, hasMore });
};

/**
 * Returns aggregated anomaly statistics for the caller's organization (cached).
 * Requires auth and ADMIN / MANAGER.
 *
 * @returns HTTP 200 with envelope `{ success, message, data }` containing anomaly stats.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when the caller lacks ADMIN / MANAGER.
 */
export const getAnomalyStats = async (req: Request, res: Response) => {
  const organizationId = req.user?.organizationId;
  const stats = await anomalyService.getAnomalyStatsService(organizationId);
  sendResponse(res, 200, true, 'Anomaly stats retrieved', stats);
};

/**
 * Marks an anomaly as resolved with an optional operator note.
 * Requires auth and ADMIN / MANAGER.
 *
 * @param req.params.id - Anomaly document id.
 * @param req.body.note - Optional resolution note (max 1000 chars).
 * @returns HTTP 200 with envelope `{ success, message, data }` containing the updated anomaly.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when the caller lacks ADMIN / MANAGER.
 * @throws {AppError} 404 ERR_NOT_FOUND — when the anomaly does not exist.
 */
export const resolveAnomaly = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { note } = req.body as { note?: string };
  const resolvedBy = req.user!.userId;

  const anomaly = await anomalyService.resolveAnomalyService(id, resolvedBy, note);

  sendResponse(res, 200, true, 'Anomaly resolved', anomaly);
};
