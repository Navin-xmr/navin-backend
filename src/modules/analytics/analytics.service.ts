import { Shipment } from '../shipments/shipments.model.js';
import { Anomaly } from '../anomaly/anomaly.model.js';
import {
  analyticsPerformanceCacheKey,
  readAnalyticsPerformanceCache,
  writeAnalyticsPerformanceCache,
  analyticsSummaryCacheKey,
  readAnalyticsSummaryCache,
  writeAnalyticsSummaryCache,
  type AnalyticsSummary,
} from './analytics.cache.js';
import type { PipelineStage } from 'mongoose';

import type { PerformanceQuery } from './analytics.validation.js';

export type AnalyticsDashboardPayload = {
  startDate: string;
  endDate: string;
  shipmentsByStatus: Array<{ status: string; total: number }>;
  averageDeliveryTimeByLogisticsId: Array<{
    logisticsId: string;
    averageDeliveryTimeMs: number;
  }>;
  totalDelayedShipments: number;
  timeSeries: Array<{
    date: string;
    shipmentCount: number;
    deliveredCount: number;
    anomalyCount: number;
  }>;
};

type AggregationRow = {
  _id?: unknown;
  total?: unknown;
  averageDeliveryTimeMs?: unknown;
};

type AggregationFacet = {
  shipmentsByStatus?: AggregationRow[];
  averageDeliveryTimeByLogisticsId?: AggregationRow[];
  delayedShipments?: Array<{ totalDelayed?: unknown }>;
  timeSeries?: Array<{
    _id: Date;
    shipmentCount: number;
    deliveredCount: number;
  }>;
};

type AnomalyTimeSeriesRow = {
  _id: Date;
  count: number;
};

/**
 * Calculates the default granularity based on date range length.
 * Defaults to daily when date range <= 30 days, weekly otherwise.
 * @param {Date} startDate - Start of the date range.
 * @param {Date} endDate - End of the date range.
 * @returns {'daily' | 'weekly' | 'monthly'} Default granularity.
 */
function calculateDefaultGranularity(
  startDate: Date,
  endDate: Date
): 'daily' | 'weekly' | 'monthly' {
  const daysDifference = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
  if (daysDifference <= 30) {
    return 'daily';
  }
  return 'weekly';
}

/**
 * Builds analytics dashboard payload for a date range.
 * @param {PerformanceQuery} query - Analytics window parameters.
 * @returns {Promise<AnalyticsDashboardPayload>} Aggregated analytics dashboard data.
 */
export async function getAnalyticsPerformance(
  query: PerformanceQuery
): Promise<AnalyticsDashboardPayload> {
  const startDate = query.startDate;
  const endDate = query.endDate;
  const granularity = query.granularity || calculateDefaultGranularity(startDate, endDate);
  const cacheKey = analyticsPerformanceCacheKey(
    startDate.toISOString(),
    endDate.toISOString(),
    granularity
  );

  const cached = await readAnalyticsPerformanceCache(cacheKey);
  if (cached) {
    return cached;
  }

  // Map granularity to MongoDB dateTrunc unit
  const dateTruncUnit =
    granularity === 'daily' ? 'day' : granularity === 'weekly' ? 'week' : 'month';

  // Performance window is based on shipment `createdAt` (the document timestamp).
  const shipmentPipeline: PipelineStage[] = [
    {
      $match: {
        createdAt: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $project: {
        status: 1,
        logisticsId: 1,
        createdAt: 1,
        deliveredTimestamp: {
          $arrayElemAt: [
            {
              $map: {
                input: {
                  $filter: {
                    input: '$milestones',
                    as: 'milestone',
                    cond: { $eq: ['$$milestone.name', 'DELIVERED'] },
                  },
                },
                as: 'deliveredMilestone',
                in: '$$deliveredMilestone.timestamp',
              },
            },
            0,
          ],
        },
      },
    },
    {
      $facet: {
        shipmentsByStatus: [
          {
            $group: {
              _id: '$status',
              total: { $sum: 1 },
            },
          },
        ],
        averageDeliveryTimeByLogisticsId: [
          { $match: { deliveredTimestamp: { $ne: null } } },
          {
            $group: {
              _id: '$logisticsId',
              averageDeliveryTimeMs: {
                $avg: { $subtract: ['$deliveredTimestamp', '$createdAt'] },
              },
            },
          },
        ],
        delayedShipments: [
          { $match: { status: { $ne: 'DELIVERED' } } },
          {
            $count: 'totalDelayed',
          },
        ],
        timeSeries: [
          {
            $group: {
              _id: {
                $dateTrunc: {
                  date: '$createdAt',
                  unit: dateTruncUnit,
                  timezone: 'UTC',
                },
              },
              shipmentCount: { $sum: 1 },
              deliveredCount: {
                $sum: {
                  $cond: [{ $ne: ['$deliveredTimestamp', null] }, 1, 0],
                },
              },
            },
          },
          { $sort: { _id: 1 } },
        ],
      },
    },
  ];

  const [shipmentFacet] = (await Shipment.aggregate(shipmentPipeline).option({
    maxTimeMS: 5000,
  })) as AggregationFacet[];

  // Get anomaly time series
  const anomalyTimeSeries = (await Anomaly.aggregate([
    {
      $match: {
        timestamp: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $group: {
        _id: {
          $dateTrunc: {
            date: '$timestamp',
            unit: dateTruncUnit,
            timezone: 'UTC',
          },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ])) as AnomalyTimeSeriesRow[];

  // Create a map for anomalies for easy lookup
  const anomalyMap = new Map<string, number>();
  anomalyTimeSeries.forEach(row => {
    anomalyMap.set(row._id.toISOString(), row.count);
  });

  const shipmentsByStatus = (shipmentFacet?.shipmentsByStatus ?? []).map((row: AggregationRow) => ({
    status: String(row._id),
    total: Number(row.total ?? 0),
  }));

  const averageDeliveryTimeByLogisticsId = (
    shipmentFacet?.averageDeliveryTimeByLogisticsId ?? []
  ).map((row: AggregationRow) => ({
    logisticsId: String(row._id),
    averageDeliveryTimeMs: Number(row.averageDeliveryTimeMs ?? 0),
  }));

  const totalDelayedShipments = Number(shipmentFacet?.delayedShipments?.[0]?.totalDelayed ?? 0);

  const timeSeries = (shipmentFacet?.timeSeries ?? []).map(row => ({
    date: row._id.toISOString(),
    shipmentCount: Number(row.shipmentCount ?? 0),
    deliveredCount: Number(row.deliveredCount ?? 0),
    anomalyCount: Number(anomalyMap.get(row._id.toISOString()) ?? 0),
  }));

  const result = {
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    shipmentsByStatus,
    averageDeliveryTimeByLogisticsId,
    totalDelayedShipments,
    timeSeries,
  };

  await writeAnalyticsPerformanceCache(cacheKey, result);

  return result;
}

/**
 * Calculates KPI summary with 30-day sparklines for dashboard.
 * Aggregates last 60 days of shipments and computes current vs previous 30-day periods.
 * Results are cached for 5 minutes.
 *
 * @param {Object} params - Parameters
 * @param {string} params.organizationId - Optional organization ID for scoped analytics
 * @returns {Promise<AnalyticsSummary>} Summary with all KPIs and sparklines
 */
export async function getAnalyticsSummary(params: {
  organizationId?: string;
}): Promise<AnalyticsSummary> {
  const cacheKey = analyticsSummaryCacheKey(params.organizationId);

  const cached = await readAnalyticsSummaryCache(cacheKey);
  if (cached) {
    return cached;
  }

  const now = new Date();
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Build match stage with optional organization filter
  const matchStage: Record<string, unknown> = {
    createdAt: { $gte: sixtyDaysAgo, $lte: now },
  };
  if (params.organizationId) {
    matchStage.organizationId = params.organizationId;
  }

  // Aggregate shipments
  const shipmentPipeline: PipelineStage[] = [
    {
      $match: matchStage,
    },
    {
      $addFields: {
        // Extract delivered timestamp from milestones
        deliveredTimestamp: {
          $arrayElemAt: [
            {
              $map: {
                input: {
                  $filter: {
                    input: '$milestones',
                    as: 'milestone',
                    cond: { $eq: ['$$milestone.name', 'DELIVERED'] },
                  },
                },
                as: 'deliveredMilestone',
                in: '$$deliveredMilestone.timestamp',
              },
            },
            0,
          ],
        },
        // Check if delivered on time (if expectedDelivery exists)
        isOnTime: {
          $cond: [
            { $ne: ['$expectedDelivery', null] },
            {
              $cond: [
                { $ne: ['$deliveredTimestamp', null] },
                { $lte: ['$deliveredTimestamp', '$expectedDelivery'] },
                false,
              ],
            },
            null, // No expectedDelivery, can't determine
          ],
        },
        // Transit days (if delivered)
        transitDays: {
          $cond: [
            { $ne: ['$deliveredTimestamp', null] },
            {
              $divide: [{ $subtract: ['$deliveredTimestamp', '$createdAt'] }, 1000 * 60 * 60 * 24],
            },
            null,
          ],
        },
        // Period indicator
        period: {
          $cond: [{ $gte: ['$createdAt', thirtyDaysAgo] }, 'CURRENT', 'PREVIOUS'],
        },
        // Day of analysis for sparkline
        dayOfAnalysis: {
          $dateTrunc: {
            date: '$createdAt',
            unit: 'day',
            timezone: 'UTC',
          },
        },
      },
    },
    {
      $facet: {
        // Current period KPIs
        currentKpis: [
          {
            $match: { period: 'CURRENT' },
          },
          {
            $group: {
              _id: null,
              totalShipments: { $sum: 1 },
              onTimeCount: {
                $sum: {
                  $cond: [{ $eq: ['$isOnTime', true] }, 1, 0],
                },
              },
              dispatchedCount: {
                $sum: {
                  $cond: [{ $ne: ['$isOnTime', null] }, 1, 0],
                },
              },
              disputedCount: {
                $sum: {
                  $cond: [
                    {
                      $gt: [
                        {
                          $size: {
                            $ifNull: ['$disputes', []],
                          },
                        },
                        0,
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              avgTransitDays: {
                $avg: '$transitDays',
              },
            },
          },
        ],
        // Previous period KPIs
        previousKpis: [
          {
            $match: { period: 'PREVIOUS' },
          },
          {
            $group: {
              _id: null,
              totalShipments: { $sum: 1 },
              onTimeCount: {
                $sum: {
                  $cond: [{ $eq: ['$isOnTime', true] }, 1, 0],
                },
              },
              dispatchedCount: {
                $sum: {
                  $cond: [{ $ne: ['$isOnTime', null] }, 1, 0],
                },
              },
              disputedCount: {
                $sum: {
                  $cond: [
                    {
                      $gt: [
                        {
                          $size: {
                            $ifNull: ['$disputes', []],
                          },
                        },
                        0,
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              avgTransitDays: {
                $avg: '$transitDays',
              },
            },
          },
        ],
        // Sparklines (30 days from current period)
        currentSparklines: [
          {
            $match: { period: 'CURRENT' },
          },
          {
            $group: {
              _id: '$dayOfAnalysis',
              shipmentCount: { $sum: 1 },
              onTimeCount: {
                $sum: {
                  $cond: [{ $eq: ['$isOnTime', true] }, 1, 0],
                },
              },
              dispatchedCount: {
                $sum: {
                  $cond: [{ $ne: ['$isOnTime', null] }, 1, 0],
                },
              },
              avgTransitDays: {
                $avg: '$transitDays',
              },
              disputedCount: {
                $sum: {
                  $cond: [
                    {
                      $gt: [
                        {
                          $size: {
                            $ifNull: ['$disputes', []],
                          },
                        },
                        0,
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            },
          },
          { $sort: { _id: 1 } },
        ],
      },
    },
  ];

  const [result] = (await Shipment.aggregate(shipmentPipeline).option({
    maxTimeMS: 10000,
  })) as Array<{
    currentKpis: Array<{
      totalShipments: number;
      onTimeCount: number;
      dispatchedCount: number;
      disputedCount: number;
      avgTransitDays: number;
    }>;
    previousKpis: Array<{
      totalShipments: number;
      onTimeCount: number;
      dispatchedCount: number;
      disputedCount: number;
      avgTransitDays: number;
    }>;
    currentSparklines: Array<{
      _id: Date;
      shipmentCount: number;
      onTimeCount: number;
      dispatchedCount: number;
      avgTransitDays: number;
      disputedCount: number;
    }>;
  }>;

  const currentKpi = result.currentKpis[0] || {
    totalShipments: 0,
    onTimeCount: 0,
    dispatchedCount: 0,
    disputedCount: 0,
    avgTransitDays: 0,
  };

  const previousKpi = result.previousKpis[0] || {
    totalShipments: 0,
    onTimeCount: 0,
    dispatchedCount: 0,
    disputedCount: 0,
    avgTransitDays: 0,
  };

  // Calculate rates
  const onTimeDeliveryRate =
    currentKpi.dispatchedCount > 0
      ? (currentKpi.onTimeCount / currentKpi.dispatchedCount) * 100
      : 0;
  const onTimeDeliveryRatePrev =
    previousKpi.dispatchedCount > 0
      ? (previousKpi.onTimeCount / previousKpi.dispatchedCount) * 100
      : 0;
  const disputeRate =
    currentKpi.totalShipments > 0
      ? (currentKpi.disputedCount / currentKpi.totalShipments) * 100
      : 0;
  const disputeRatePrev =
    previousKpi.totalShipments > 0
      ? (previousKpi.disputedCount / previousKpi.totalShipments) * 100
      : 0;

  // Build sparklines (30 days, one value per day)
  const sparklineMap = new Map<number, Record<string, number>>();
  result.currentSparklines.forEach(day => {
    const dayTime = day._id.getTime();
    sparklineMap.set(dayTime, {
      shipmentCount: day.shipmentCount || 0,
      onTimeCount: day.onTimeCount || 0,
      dispatchedCount: day.dispatchedCount || 0,
      avgTransitDays: day.avgTransitDays || 0,
      disputedCount: day.disputedCount || 0,
    });
  });

  // Generate 30-day sparklines
  const onTimeDeliverySparkline: number[] = [];
  const averageTransitSparkline: number[] = [];
  const shipmentsSparkline: number[] = [];
  const disputesSparkline: number[] = [];

  for (let i = 29; i >= 0; i--) {
    const dayTime = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    dayTime.setUTCHours(0, 0, 0, 0);
    const dayData = sparklineMap.get(dayTime.getTime());

    if (dayData) {
      const rate =
        dayData.dispatchedCount > 0 ? (dayData.onTimeCount / dayData.dispatchedCount) * 100 : 0;
      onTimeDeliverySparkline.push(Math.round(rate));
      averageTransitSparkline.push(
        dayData.avgTransitDays ? Math.round(dayData.avgTransitDays * 10) / 10 : 0
      );
      shipmentsSparkline.push(dayData.shipmentCount);
      disputesSparkline.push(dayData.disputedCount);
    } else {
      onTimeDeliverySparkline.push(0);
      averageTransitSparkline.push(0);
      shipmentsSparkline.push(0);
      disputesSparkline.push(0);
    }
  }

  const summary: AnalyticsSummary = {
    onTimeDeliveryRate: Math.round(onTimeDeliveryRate * 10) / 10,
    onTimeDeliveryRatePrev: Math.round(onTimeDeliveryRatePrev * 10) / 10,
    onTimeDeliverySparkline,
    averageTransitDays:
      currentKpi.avgTransitDays > 0 ? Math.round(currentKpi.avgTransitDays * 10) / 10 : 0,
    averageTransitDaysPrev:
      previousKpi.avgTransitDays > 0 ? Math.round(previousKpi.avgTransitDays * 10) / 10 : 0,
    averageTransitSparkline,
    totalShipmentsThisMonth: currentKpi.totalShipments,
    totalShipmentsPrevMonth: previousKpi.totalShipments,
    shipmentsSparkline,
    disputeRate: Math.round(disputeRate * 10) / 10,
    disputeRatePrev: Math.round(disputeRatePrev * 10) / 10,
    disputesSparkline,
    lastUpdated: new Date().toISOString(),
  };

  await writeAnalyticsSummaryCache(cacheKey, summary);

  return summary;
}
