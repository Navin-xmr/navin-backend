import type { RequestHandler } from 'express';

import type { IotWebhookBody } from './iot.validation.js';
import { processIotWebhook } from './iot.service.js';
import { sendResponse } from '../../shared/http/sendResponse.js';

/**
 * Accepts IoT device telemetry webhooks, persists readings, and queues Stellar anchoring.
 * Authenticated via `x-api-key` (`requireApiKey`), not JWT.
 *
 * @param req.body - Normalized telemetry fields or sensor-shaped payload (`temp`/`location`).
 * @returns HTTP 202 with envelope `{ success, message, data }` containing the persisted telemetry.
 * @throws {AppError} 401 UNAUTHORIZED — when the API key header is missing or invalid.
 * @throws {AppError} 400 VALIDATION_ERROR — when body validation fails.
 * @throws {AppError} 404 NOT_FOUND — when no active shipment matches the sensor id.
 * @throws {AppError} 400 ERR_BAD_REQUEST — when shipmentId cannot be resolved.
 */
export const iotWebhookController: RequestHandler = async (req, res) => {
  const body = req.body as IotWebhookBody;
  const telemetry = await processIotWebhook(body);

  // Respond immediately with 202 Accepted
  sendResponse(res, 202, true, 'Telemetry received and queued for Stellar anchoring', telemetry);
};
