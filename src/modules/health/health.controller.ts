import type { RequestHandler } from 'express';
import { sendResponse } from '../../shared/http/sendResponse.js';

/**
 * Liveness check for the API process (no auth).
 *
 * @returns HTTP 200 with envelope `{ success, message, data }` where data includes `status`, `uptime`, and `timestamp`.
 */
export const healthController: RequestHandler = (_req, res) => {
  sendResponse(res, 200, true, 'OK', {
    status: 'active',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
};
