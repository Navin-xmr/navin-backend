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

// ─── Chain read param schemas (P14-12) ───

export const ChainShipmentStatusParamSchema = z.object({
  shipmentId: z.string().min(1),
});

export type ChainShipmentStatusParam = z.infer<typeof ChainShipmentStatusParamSchema>;

export const ChainPaymentIdParamSchema = z.object({
  paymentId: z.string().min(1),
});

export type ChainPaymentIdParam = z.infer<typeof ChainPaymentIdParamSchema>;
