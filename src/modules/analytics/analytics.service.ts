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
          // Unwind milestones only for delivered milestones.
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
          {
            $group: {
              _id: null,
              // "Delayed" here means not delivered by the time window (i.e. status != DELIVERED).
              totalDelayed: {
                $sum: {
                  $cond: [{ $ne: ['$status', 'DELIVERED'] }, 1, 0],
                },
              },
            },
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
