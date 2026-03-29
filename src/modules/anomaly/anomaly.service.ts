import { Anomaly } from './anomaly.model.js';
import type { FilterQuery } from 'mongoose';
import { evaluateTelemetry } from '../../services/anomaly.service.js';

interface TelemetryData {
  _id: string;
  shipmentId: string;
  temperature: number;
  humidity: number;
  batteryLevel: number;
  timestamp?: Date;
}

interface AnomalyResult {
  detected: boolean;
  anomalies: Array<{
    _id: string;
    shipmentId: string;
    type: string;
    severity: string;
    message: string;
    timestamp: string;
    resolved: boolean;
  }>;
}

export async function detectAnomaly(data: TelemetryData): Promise<AnomalyResult> {
  const timestamp = data.timestamp ?? new Date();
  const thresholds = {
    maxTemp: 25,
    maxHumidity: 80,
    minBatteryLevel: 20,
  };

  const evaluated = evaluateTelemetry(
    {
      shipmentId: data.shipmentId,
      timestamp,
      temperature: data.temperature,
      humidity: data.humidity,
      batteryLevel: data.batteryLevel,
    },
    thresholds
  );

  if (evaluated.length === 0) return { detected: false, anomalies: [] };

  const created = await Anomaly.create(
    evaluated.map(a => ({
      shipmentId: a.shipmentId,
      type: a.type,
      severity: a.severity,
      message: a.message,
      timestamp: a.timestamp,
      resolved: a.resolved,
    }))
  );

  const docs = Array.isArray(created) ? created : [created];
  const anomalies = docs.map(doc => {
    const obj = doc.toObject();
    return {
      _id: obj._id.toString(),
      shipmentId: obj.shipmentId.toString(),
      type: obj.type,
      severity: obj.severity,
      message: obj.message,
      timestamp: new Date(obj.timestamp).toISOString(),
      resolved: obj.resolved,
    };
  });

  return { detected: true, anomalies };
}

export async function getAnomaliesService(params: {
  cursor?: string;
  limit: number;
  shipmentId?: string;
  severity?: string;
}) {
  const { cursor, limit, shipmentId, severity } = params;
  const query: FilterQuery<unknown> = {};

  if (shipmentId) query.shipmentId = shipmentId;
  if (severity) query.severity = severity;
  if (cursor) query._id = { $lt: cursor };

  const anomalies = await Anomaly.find(query)
    .select('-__v')
    .sort({ timestamp: -1, _id: -1 })
    .limit(limit + 1)
    .lean();

  const hasMore = anomalies.length > limit;
  const data = hasMore ? anomalies.slice(0, limit) : anomalies;
  const nextCursor = hasMore && data.length > 0 ? data[data.length - 1]._id.toString() : null;

  return { data, nextCursor, hasMore };
}
