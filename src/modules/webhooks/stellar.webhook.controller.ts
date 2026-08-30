import type { RequestHandler } from 'express';
import { sendResponse } from '../../shared/http/sendResponse.js';
import * as stellarWebhookService from './stellar.webhook.service.js';

/**
 * Handles Stellar settlement webhook callbacks (`release` | `escrow` | `failed`).
 * Authenticated via HMAC signature middleware (`verifyStellarSignature`), not JWT.
 *
 * @param req.body.id - Webhook event id.
 * @param req.body.type - Event type: `release` | `escrow` | `failed`.
 * @param req.body.paymentId - Settlement/payment id to update.
 * @param req.body.transactionHash - On-chain transaction hash.
 * @param req.body.amount - Settlement amount.
 * @param req.body.timestamp - Event timestamp (ISO datetime).
 * @param req.body.signature - Optional signature field on the payload.
 * @returns HTTP 200 with envelope `{ success, message, data }` for the processed event result.
 * @throws {AppError} 500 ERR_STELLAR_CONFIG — when the webhook secret is not configured.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when the signature header is missing or invalid.
 * @throws {AppError} 400 ERR_BAD_REQUEST — when the request body is missing.
 * @throws {AppError} 400 VALIDATION_ERROR — when payload validation fails.
 * @throws {AppError} 400 UNKNOWN_EVENT_TYPE — when the event type is not recognized.
 * @throws {AppError} 404 ERR_PAYMENT_NOT_FOUND — when the referenced settlement does not exist.
 * @throws {AppError} 500 ERR_INTERNAL_SERVER_ERROR — when payment status update fails.
 */
export const handleStellarWebhookController: RequestHandler = async (req, res) => {
  const result = await stellarWebhookService.handleStellarWebhookEvent(req.body);
  sendResponse(res, 200, true, 'Webhook processed successfully', result);
};
