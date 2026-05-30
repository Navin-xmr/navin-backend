import { z } from 'zod';
import { ANOMALY_SEVERITIES, ANOMALY_TYPES } from '../../shared/types/anomaly.js';

export const AnomalyQuerySchema = z.object({
  cursor: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  shipmentId: z.string().trim().optional(),
  severity: z.enum(ANOMALY_SEVERITIES).optional(),
  type: z.enum(ANOMALY_TYPES).optional(),
  resolved: z.coerce.boolean().optional(),
});

export const ResolveAnomalyParamsSchema = z.object({
  id: z.string().trim().min(1),
});
