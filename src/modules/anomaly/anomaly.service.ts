import { Anomaly } from './anomaly.model.js';
import type { FilterQuery } from 'mongoose';
import { evaluateTelemetry } from '../../services/anomaly.service.js';
import { getRedisClient } from '../../infra/redis/connection.js';

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

/**
 * Detects anomalies from telemetry data and persists any findings.
 * @param {TelemetryData} data - Telemetry values used for anomaly evaluation.
 * @returns {Promise<AnomalyResult>} Detection result and created anomaly records.
 */
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

/**
 * Retrieves anomalies with cursor-based pagination and optional filters.
 * @param {object} params - Query options for anomalies.
 * @param {string=} params.cursor - Optional cursor for pagination.
 * @param {number} params.limit - Maximum number of records to return.
 * @param {string=} params.shipmentId - Optional shipment filter.
 * @param {string=} params.severity - Optional severity filter.
 * @returns {Promise<{data: unknown[]; nextCursor: string | null; hasMore: boolean}>} Paginated anomalies.
 */
export async function getAnomaliesService(params: {
  cursor?: string;
  limit: number;
  shipmentId?: string;
  severity?: string;
  type?: string;
  resolved?: boolean;
}) {
  const { cursor, limit, shipmentId, severity, type, resolved } = params;
  const query: FilterQuery<unknown> = {};

  if (shipmentId) query.shipmentId = shipmentId;
  if (severity) query.severity = severity;
  if (type) query.type = type;
  if (resolved !== undefined) query.resolved = resolved;
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

/**
 * Resolves an existing anomaly record with optional resolution metadata.
 * @param {string} id - Anomaly ObjectId.
 * @param {string} resolvedBy - User ID from JWT.
 * @param {string=} resolutionNote - Optional note explaining the resolution.
 * @returns {Promise<unknown>} Updated anomaly document.
 * @throws {Error} When the anomaly cannot be found.
 */
export async function resolveAnomalyService(id: string, resolvedBy: string, resolutionNote?: string) {
  const anomaly = await Anomaly.findByIdAndUpdate(
    id,
    { resolved: true, resolvedAt: new Date(), resolvedBy, ...(resolutionNote !== undefined && { resolutionNote }) },
    { new: true, runValidators: true }
  ).lean();
 * Resolves an existing anomaly record, recording who resolved it and an optional note.
 * @param {string} id - Anomaly ObjectId.
 * @param {string} resolvedBy - ID of the authenticated user performing the resolution.
 * @param {string=} note - Optional resolution note explaining why it was resolved.
 * @returns {Promise<unknown>} Updated anomaly document.
 * @throws {Error} When the anomaly cannot be found.
 */
export async function resolveAnomalyService(id: string, resolvedBy: string, note?: string) {
  const update: Record<string, unknown> = {
    resolved: true,
    resolvedAt: new Date(),
    resolvedBy,
  };
  if (note !== undefined) {
    update.resolutionNote = note;
  }

  const anomaly = await Anomaly.findByIdAndUpdate(id, update, {
    new: true,
    runValidators: true,
  }).lean();

  if (!anomaly) {
    throw new Error('Anomaly not found');
  }

  return anomaly;
}

const ANOMALY_STATS_KEY = 'anomaly:stats';
const ANOMALY_STATS_TTL = 300; // 5 minutes

/**
 * Returns aggregated anomaly statistics, cached in Redis for 5 minutes.
 * @param {string=} organizationId - Optional org scope.
 */
export async function getAnomalyStatsService(organizationId?: string) {
  const cacheKey = organizationId ? `${ANOMALY_STATS_KEY}:${organizationId}` : ANOMALY_STATS_KEY;

  let redis: ReturnType<typeof getRedisClient> | null = null;
  try {
    redis = getRedisClient();
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch {
    // proceed without cache
  }

  const matchStage = organizationId
    ? { $match: { deletedAt: null, resolved: false, 'shipmentId.organizationId': organizationId } }
    : { $match: { deletedAt: null } };

  const [result] = await Anomaly.aggregate([
    matchStage,
    {
      $facet: {
        totalActive: [{ $match: { resolved: false } }, { $count: 'count' }],
        bySeverity: [{ $match: { resolved: false } }, { $group: { _id: '$severity', count: { $sum: 1 } } }],
        byType: [{ $match: { resolved: false } }, { $group: { _id: '$type', count: { $sum: 1 } } }],
        totals: [{ $group: { _id: null, total: { $sum: 1 }, resolved: { $sum: { $cond: ['$resolved', 1, 0] } } } }],
      },
    },
  ]);

  const totalActive = result.totalActive[0]?.count ?? 0;
  const totals = result.totals[0] ?? { total: 0, resolved: 0 };
  const resolutionRate = totals.total > 0 ? totals.resolved / totals.total : 0;

  const bySeverity: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const { _id, count } of result.bySeverity) {
    bySeverity[(_id as string).toLowerCase()] = count;
  }

  const byType: Record<string, number> = {};
  for (const { _id, count } of result.byType) {
    byType[_id as string] = count;
  }

  const stats = { totalActive, bySeverity, byType, resolutionRate };

  try {
    await redis?.set(cacheKey, JSON.stringify(stats), 'EX', ANOMALY_STATS_TTL);
/**
 * Returns aggregated anomaly statistics for dashboard widgets.
 * Results are cached in Redis for 5 minutes.
 */
export async function getAnomalyStatsService(organizationId?: string) {
  const { getRedisClient } = await import('../../infra/redis/connection.js');
  const STATS_CACHE_KEY = `anomaly:stats:${organizationId ?? 'global'}`;
  const STATS_CACHE_TTL = 300;

  let client: import('ioredis').Redis | null = null;
  try {
    client = getRedisClient() as import('ioredis').Redis;
    const cached = await client.get(STATS_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch {
    client = null;
  }

  const matchStage: Record<string, unknown> = { deletedAt: null };
  if (organizationId) {
    matchStage.organizationId = organizationId;
  }

  const [result] = await Anomaly.aggregate([
    { $match: matchStage },
    {
      $facet: {
        totalActive: [{ $match: { resolved: false } }, { $count: 'count' }],
        totalAll: [{ $count: 'count' }],
        resolved: [{ $match: { resolved: true } }, { $count: 'count' }],
        bySeverity: [
          { $match: { resolved: false } },
          { $group: { _id: '$severity', count: { $sum: 1 } } },
        ],
        byType: [
          { $match: { resolved: false } },
          { $group: { _id: '$type', count: { $sum: 1 } } },
        ],
      },
    },
  ]);

  const totalActive: number = result.totalActive[0]?.count ?? 0;
  const totalAll: number = result.totalAll[0]?.count ?? 0;
  const resolvedCount: number = result.resolved[0]?.count ?? 0;

  const bySeverity: Record<string, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const entry of result.bySeverity) {
    bySeverity[entry._id] = entry.count;
  }

  const byType: Record<string, number> = {};
  for (const entry of result.byType) {
    byType[entry._id] = entry.count;
  }

  const resolutionRate = totalAll > 0 ? Math.round((resolvedCount / totalAll) * 100) / 100 : 0;

  const stats = { totalActive, bySeverity, byType, resolutionRate };

  try {
    if (client) {
      await client.set(STATS_CACHE_KEY, JSON.stringify(stats), 'EX', STATS_CACHE_TTL);
    }
  } catch {
    // cache write failure is non-fatal
  }

  return stats;
}
