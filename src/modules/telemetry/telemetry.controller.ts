import type { Request, Response } from 'express';
import { getTelemetryService, bulkIngestTelemetry, getTelemetryThresholds } from './telemetry.service.js';
import { sendResponse } from '../../shared/http/sendResponse.js';
import type { BulkTelemetryBody } from './telemetry.validation.js';

export const getTelemetry = async (req: Request, res: Response) => {
  const { cursor, page, limit = 20, shipmentId, from, to } = req.query;
  const user = req.user;
  const organizationId = user?.organizationId;
  const { data, nextCursor, hasMore } = await getTelemetryService({
    cursor: cursor as string | undefined,
    page: page ? Number(page) : undefined,
    limit: Number(limit),
    shipmentId: shipmentId as string | undefined,
    organizationId: organizationId as string | undefined,
    from: from as Date | undefined,
    to: to as Date | undefined,
  });

  sendResponse(res, 200, true, 'Telemetry retrieved', data, {
    nextCursor,
    hasMore,
    page: page ? Number(page) : 1,
  });
};

export const bulkIngest = async (req: Request, res: Response) => {
  const body = req.body as BulkTelemetryBody;

  const result = await bulkIngestTelemetry(body.items);

  sendResponse(res, 201, true, 'Bulk telemetry ingested', result);
};

export const getThresholds = async (req: Request, res: Response) => {
  const data = getTelemetryThresholds();
  sendResponse(res, 200, true, 'Thresholds retrieved', data);
};
