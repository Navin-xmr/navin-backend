import type { RequestHandler } from 'express';

import type { PerformanceQuery } from './analytics.validation.js';
import { getAnalyticsPerformance } from './analytics.service.js';

export const getPerformanceController: RequestHandler = async (req, res) => {
  const query = req.query as unknown as PerformanceQuery;
  const dashboard = await getAnalyticsPerformance(query);
  res.json({ data: dashboard });
};

