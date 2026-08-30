import { z } from 'zod';
import { MilestoneEvent } from '../../shared/types/shipment.js';

export const LedgerBlockIdParamSchema = z.object({
  id: z.string().min(1),
});

export type LedgerBlockIdParam = z.infer<typeof LedgerBlockIdParamSchema>;

export const GetLedgerBlocksQuerySchema = z.object({
  shipmentId: z.string().min(1).optional(),
  milestoneEvent: z.nativeEnum(MilestoneEvent).optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type GetLedgerBlocksQuery = z.infer<typeof GetLedgerBlocksQuerySchema>;
