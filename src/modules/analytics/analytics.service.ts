import { Shipment } from '../shipments/shipments.model.js';
import { Anomaly } from '../anomaly/anomaly.model.js';
import {
  analyticsPerformanceCacheKey,
  readAnalyticsPerformanceCache,
  writeAnalyticsPerformanceCache,
} from './analytics.cache.js';

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
function calculateDefaultGranularity(startDate: Date, endDate: Date): 'daily' | 'weekly' | 'monthly' {
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
  const cacheKey = analyticsPerformanceCacheKey(startDate.toISOString(), endDate.toISOString(), granularity);

  const cached = await readAnalyticsPerformanceCache(cacheKey);
  if (cached) {
    return cached;
  }

  // Map granularity to MongoDB dateTrunc unit
  const dateTruncUnit = granularity === 'daily' ? 'day' : granularity === 'weekly' ? 'week' : 'month';

  // Performance window is based on shipment `createdAt` (the document timestamp).
  const shipmentPipeline = [
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
  const anomalyTimeSeries = await Anomaly.aggregate([
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
  ]) as AnomalyTimeSeriesRow[];

  // Create a map for anomalies for easy lookup
  const anomalyMap = new Map<string, number>();
  anomalyTimeSeries.forEach(row => {
    anomalyMap.set(row._id.toISOString(), row.count);
  });

  const shipmentsByStatus = (shipmentFacet?.shipmentsByStatus ?? []).map((row: AggregationRow) => ({
    status: String(row._id),
    total: Number(row.total ?? 0),
  }));

  const averageDeliveryTimeByLogisticsId = (shipmentFacet?.averageDeliveryTimeByLogisticsId ?? []).map(
    (row: AggregationRow) => ({
      logisticsId: String(row._id),
      averageDeliveryTimeMs: Number(row.averageDeliveryTimeMs ?? 0),
    })
  );

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
