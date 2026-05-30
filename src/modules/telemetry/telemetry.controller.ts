import type { Request, Response } from 'express';
import { getTelemetryService, bulkIngestTelemetry } from './telemetry.service.js';
import { sendResponse } from '../../shared/http/sendResponse.js';
import type { BulkTelemetryBody } from './telemetry.validation.js';

export const getTelemetry = async (req: Request, res: Response) => {
  const { cursor, limit = 20, shipmentId } = req.query;
  const user = (req as any).user;
  const organizationId = user?.organizationId;
  const { data, nextCursor, hasMore } = await getTelemetryService({
    cursor: cursor as string | undefined,
    page: pageNumber,
    limit: Number(limit),
    shipmentId: shipmentId as string | undefined,
    organizationId: organizationId as string | undefined,
  });

  sendResponse(res, 200, true, 'Telemetry retrieved', data, {
    nextCursor,
    hasMore,
    page: pageNumber ?? 1,
  });
};

export const bulkIngest = async (req: Request, res: Response) => {
  const body = req.body as BulkTelemetryBody;

  const result = await bulkIngestTelemetry(body.items);

  sendResponse(res, 201, true, 'Bulk telemetry ingested', result);
};
