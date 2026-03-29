import { Shipment } from '../shipments/shipments.model.js';

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
};

export async function getAnalyticsPerformance(
  query: PerformanceQuery
): Promise<AnalyticsDashboardPayload> {
  const startDate = query.startDate;
  const endDate = query.endDate;

  // Performance window is based on shipment `createdAt` (the document timestamp).
  const pipeline = [
    {
      $match: {
        createdAt: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $project: {
        status: 1,
        logisticsId: 1,
        milestones: 1,
        createdAt: 1,
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
          { $match: { 'milestones.name': 'DELIVERED' } },
          { $unwind: '$milestones' },
          { $match: { 'milestones.name': 'DELIVERED' } },
          {
            $group: {
              _id: '$logisticsId',
              averageDeliveryTimeMs: {
                $avg: { $subtract: ['$milestones.timestamp', '$createdAt'] },
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
      },
    },
  ];

  const [facet] = (await Shipment.aggregate(pipeline)) as AggregationFacet[];

  const shipmentsByStatus = (facet?.shipmentsByStatus ?? []).map(row => ({
    status: String(row._id),
    total: Number(row.total ?? 0),
  }));

  const averageDeliveryTimeByLogisticsId = (facet?.averageDeliveryTimeByLogisticsId ?? []).map(
    row => ({
      logisticsId: String(row._id),
      averageDeliveryTimeMs: Number(row.averageDeliveryTimeMs ?? 0),
    })
  );

  const totalDelayedShipments = Number(facet?.delayedShipments?.[0]?.totalDelayed ?? 0);

  return {
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    shipmentsByStatus,
    averageDeliveryTimeByLogisticsId,
    totalDelayedShipments,
  };
}
