import type { RequestHandler } from 'express';

import type { PerformanceQuery, SummaryQuery } from './analytics.validation.js';
import { getAnalyticsPerformance, getAnalyticsSummary } from './analytics.service.js';
import { sendResponse } from '../../shared/http/sendResponse.js';

/**
 * Returns performance analytics for the requested date range.
 * Requires auth and ADMIN / MANAGER.
 *
 * @param req.query.startDate - Range start (UTC ISO 8601).
 * @param req.query.endDate - Range end (UTC ISO 8601, must be >= startDate).
 * @param req.query.granularity - Optional bucket size: `daily` | `weekly` | `monthly`.
 * @returns HTTP 200 with envelope `{ success, message, data }` containing the performance dashboard.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when the caller lacks ADMIN / MANAGER.
 * @throws {AppError} 400 VALIDATION_ERROR — when query validation fails.
 */
export const getPerformanceController: RequestHandler = async (req, res) => {
  const query = req.query as unknown as PerformanceQuery;
  const dashboard = await getAnalyticsPerformance(query);
  sendResponse(res, 200, true, 'Analytics retrieved', dashboard);
};

/**
 * Returns KPI summary with 30-day sparklines for dashboard.
 * Aggregates last 60 days of shipments to compute current vs previous 30-day periods.
 * Results are cached for 5 minutes.
 * Requires auth and ADMIN / MANAGER.
 *
 * @param req.query.organizationId - Optional organization ID for scoped analytics.
 * @returns HTTP 200 with envelope containing KPI summary with sparklines.
 * @throws {AppError} 401 ERR_AUTH_INVALID — when JWT auth fails.
 * @throws {AppError} 403 ERR_PERMISSION_DENIED — when the caller lacks ADMIN / MANAGER.
 */
export const getSummaryController: RequestHandler = async (req, res) => {
  const query = req.query as unknown as SummaryQuery;
  const summary = await getAnalyticsSummary({
    organizationId: query.organizationId,
  });
  sendResponse(res, 200, true, 'Summary retrieved', summary);
};
