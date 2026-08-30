import { z } from 'zod';
import { ANOMALY_SEVERITIES, ANOMALY_TYPES } from '../../shared/types/anomaly.js';

/**
 * Query schema for `GET /api/anomalies`.
 *
 * Business domain: ops triage of cold-chain / shipment anomalies raised from telemetry.
 * Cursor pagination matches other high-volume feeds; filters (shipmentId, severity,
 * type, resolved) let managers focus on open high-severity incidents without paging
 * through historical noise.
 */
export const AnomalyQuerySchema = z.object({
  cursor: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  shipmentId: z.string().trim().optional(),
  severity: z.enum(ANOMALY_SEVERITIES).optional(),
  type: z.enum(ANOMALY_TYPES).optional(),
  resolved: z.coerce.boolean().optional(),
});

/**
 * Path-param schema for `POST /api/anomalies/:id/resolve` (and related anomaly-by-id routes).
 *
 * Business domain: identify the anomaly record being resolved or inspected.
 */
export const ResolveAnomalyParamsSchema = z.object({
  id: z.string().trim().min(1),
});

/**
 * Body schema for resolving an anomaly.
 *
 * Business domain: optional operator note explaining remediation. Length is capped
 * so resolution notes stay concise in timelines and alert UIs.
 */
export const ResolveAnomalyBodySchema = z.object({
  note: z.string().trim().max(1000).optional(),
});
