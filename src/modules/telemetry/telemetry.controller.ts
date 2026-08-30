import type { Request, Response } from 'express';
import { getTelemetryService, bulkIngestTelemetry } from './telemetry.service.js';
import {
  getOrgTelemetryThresholdsService,
  updateOrgTelemetryThresholdsService,
} from './telemetryThreshold.service.js';
import { sendResponse } from '../../shared/http/sendResponse.js';
import type { BulkTelemetryBody } from './telemetry.validation.js';
import { AppError, ErrorCodes } from '../../shared/http/errors.js';

/**
 * Lists telemetry readings with cursor or page pagination, scoped to the caller's organization.
 * Requires authentication.
 *
 * @param req.query.cursor - Optional cursor (mutually exclusive with `page`).
 * @param req.query.page - Optional 1-based page number (mutually exclusive with `cursor`).
 * @param req.query.limit - Page size (default 20).
 * @param req.query.shipmentId - Optional shipment filter.
 * @param req.query.from - Optional UTC ISO start of time window.
 * @param req.query.to - Optional UTC ISO end of time window.
 * @returns HTTP 200 with envelope `{ success, message, data, meta }` (`nextCursor`, `hasMore`, optional `page`).
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 400 VALIDATION_ERROR — when query validation fails.
 */
export const getTelemetry = async (req: Request, res: Response) => {
  const { cursor, page, limit = 20, shipmentId, from, to } = req.query;
  const user = req.user;
  const organizationId = user?.organizationId;
  // Cursor takes precedence; Zod rejects cursor + page together.
  const pageNum = page ? Number(page) : undefined;
  const { data, nextCursor, hasMore } = await getTelemetryService({
    cursor: cursor as string | undefined,
    page: cursor ? undefined : pageNum,
    limit: Number(limit),
    shipmentId: shipmentId as string | undefined,
    organizationId: organizationId as string | undefined,
    from: from as Date | undefined,
    to: to as Date | undefined,
  });

  const meta: Record<string, unknown> = { nextCursor, hasMore };
  if (!cursor && pageNum) {
    meta.page = pageNum;
  }

  sendResponse(res, 200, true, 'Telemetry retrieved', data, meta);
};

/**
 * Bulk-ingests telemetry items for authenticated clients (JWT path).
 * Requires authentication.
 *
 * @param req.body.items - Array of telemetry payloads (1–1000 items).
 * @returns HTTP 201 with envelope `{ success, message, data }` summarizing inserted records.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 400 VALIDATION_ERROR — when body validation fails.
 * @throws {AppError} 404 ERR_NOT_FOUND — when a sensor has no matching active shipment.
 * @throws {AppError} 400 ERR_BAD_REQUEST — when shipmentId cannot be resolved for an item.
 */
export const bulkIngest = async (req: Request, res: Response) => {
  const body = req.body as BulkTelemetryBody;

  const result = await bulkIngestTelemetry(body.items);

  sendResponse(res, 201, true, 'Bulk telemetry ingested', result);
};

/**
 * Retrieves effective org telemetry thresholds (optionally by shipment type).
 * Requires auth and SUPER_ADMIN / ADMIN / MANAGER / VIEWER.
 *
 * @param req.query.shipmentType - Optional shipment-type profile key.
 * @returns HTTP 200 with envelope `{ success, message, data }` containing threshold values.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when role is insufficient or organization context is missing.
 * @throws {AppError} 400 VALIDATION_ERROR — when query validation fails.
 */
export const getTelemetryThresholds = async (req: Request, res: Response) => {
  const organizationId = req.user?.organizationId;
  if (!organizationId) {
    throw new AppError(403, 'Organization context required', ErrorCodes.FORBIDDEN);
  }

  const shipmentType = req.query.shipmentType as string | undefined;
  const result = await getOrgTelemetryThresholdsService(organizationId, shipmentType);
  sendResponse(res, 200, true, 'Telemetry thresholds retrieved', result);
};

/**
 * Updates organization telemetry thresholds used for anomaly detection.
 * Requires auth and SUPER_ADMIN / ADMIN.
 *
 * @param req.body.shipmentType - Optional shipment-type profile to update.
 * @param req.body.maxTemp - Optional max temperature (null clears override).
 * @param req.body.minTemp - Optional min temperature (null clears override).
 * @param req.body.maxHumidity - Optional max humidity (null clears override).
 * @param req.body.minHumidity - Optional min humidity (null clears override).
 * @param req.body.minBatteryLevel - Optional min battery level (null clears override).
 * @returns HTTP 200 with envelope `{ success, message, data }` containing updated thresholds.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when role is insufficient or organization context is missing.
 * @throws {AppError} 400 VALIDATION_ERROR — when body validation fails.
 */
export const putTelemetryThresholds = async (req: Request, res: Response) => {
  const organizationId = req.user?.organizationId;
  if (!organizationId) {
    throw new AppError(403, 'Organization context required', ErrorCodes.FORBIDDEN);
  }

  const result = await updateOrgTelemetryThresholdsService(organizationId, req.body);
  sendResponse(res, 200, true, 'Telemetry thresholds updated', result);
};
