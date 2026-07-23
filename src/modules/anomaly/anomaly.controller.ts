import type { Request, Response } from 'express';
import * as anomalyService from './anomaly.service.js';
import { sendResponse } from '../../shared/http/sendResponse.js';

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

export const getAnomalyStats = async (req: Request, res: Response) => {
  const organizationId = req.user?.organizationId;
  const stats = await anomalyService.getAnomalyStatsService(organizationId);
  sendResponse(res, 200, true, 'Anomaly stats retrieved', stats);
};

export const resolveAnomaly = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { note } = req.body as { note?: string };
  const resolvedBy = req.user!.userId;

  const anomaly = await anomalyService.resolveAnomalyService(id, resolvedBy, note);

  sendResponse(res, 200, true, 'Anomaly resolved', anomaly);
};
