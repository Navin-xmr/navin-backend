import type { RequestHandler } from 'express';
import { sendResponse } from '../../shared/http/sendResponse.js';

export const healthController: RequestHandler = (_req, res) => {
  sendResponse(res, 200, true, 'OK', {
    status: 'active',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
};
