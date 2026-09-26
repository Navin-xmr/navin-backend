import type { Request, Response } from 'express';
import { sendResponse } from '../../shared/http/sendResponse.js';
import { getPublicTrackingService } from './publicTracking.service.js';
import type { PublicTrackingParam } from './publicTracking.validation.js';

/**
 * Public shipment tracking by tracking number.
 * Route: `GET /api/public/tracking/:trackingNumber`. No authentication required.
 *
 * @returns HTTP 200 with envelope `{ success, message, data }` containing public tracking info.
 * @throws {AppError} 404 ERR_SHIPMENT_NOT_FOUND — when the shipment does not exist.
 * @throws {AppError} 400 VALIDATION_ERROR — when the trackingNumber param is invalid.
 */
export const getPublicTrackingController = async (req: Request, res: Response): Promise<void> => {
  const { trackingNumber } = req.params as unknown as PublicTrackingParam;
  const result = await getPublicTrackingService({ trackingNumber });
  sendResponse(res, 200, true, 'Shipment tracking retrieved', result);
};
