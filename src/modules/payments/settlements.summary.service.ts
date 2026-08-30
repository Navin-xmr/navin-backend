import { AppError, ErrorCodes } from '../../shared/http/errors.js';
import * as paymentsRepo from './payments.repo.js';
import {
  settlementSummaryCacheKey,
  readSummaryCache,
  writeSummaryCache,
} from './settlements.cache.js';

export type SummaryPeriod = 'week' | 'month' | 'quarter';

export interface SettlementSummaryResult {
  totalReleased: number;
  totalInEscrow: number;
  totalPending: number;
  sparkline: number[];
  period: SummaryPeriod;
}

const PERIOD_DAYS: Record<SummaryPeriod, number> = {
  week: 7,
  month: 30,
  quarter: 90,
};

/**
 * Returns aggregated settlement totals and a per-day sparkline for the given period.
 * Results are cached in Redis for 5 minutes.
 *
 * @param {string} organizationId - Scoped organization.
 * @param {SummaryPeriod} period - Aggregation window: week | month | quarter.
 * @returns {Promise<SettlementSummaryResult>} Summary payload.
 * @throws {AppError} 400 when period is invalid.
 */
export async function getSettlementSummaryService(
  organizationId: string,
  period: string
): Promise<SettlementSummaryResult> {
  if (!['week', 'month', 'quarter'].includes(period)) {
    throw new AppError(
      400,
      'Invalid period. Must be one of: week, month, quarter.',
      ErrorCodes.BAD_REQUEST
    );
  }

  const validPeriod = period as SummaryPeriod;
  const days = PERIOD_DAYS[validPeriod];
  const cacheKey = settlementSummaryCacheKey(organizationId, validPeriod);

  const cached = await readSummaryCache<SettlementSummaryResult>(cacheKey);
  if (cached) return cached;

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days + 1);
  since.setUTCHours(0, 0, 0, 0);

  const [totals, sparkline] = await Promise.all([
    paymentsRepo.aggregateSettlementSummary(organizationId, since),
    paymentsRepo.buildSettlementSparkline(organizationId, since, days),
  ]);

  const result: SettlementSummaryResult = {
    totalReleased: totals.totalReleased,
    totalInEscrow: totals.totalInEscrow,
    totalPending: totals.totalPending,
    sparkline,
    period: validPeriod,
  };

  await writeSummaryCache(cacheKey, result);

  return result;
}
