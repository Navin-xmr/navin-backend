import { z } from 'zod';
import { ShipmentStatus } from './shipments.model.js';

export const getShipmentsQuerySchema = z
  .object({
    status: z.string().optional(),
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(100).default(20),
    origin: z.string().optional(),
    destination: z.string().optional(),
  })
  .strict();

export type GetShipmentsQuery = z.infer<typeof getShipmentsQuerySchema>;

export const BulkStatusUpdateBodySchema = z.object({
  shipmentIds: z.array(z.string().min(1)).min(1).max(50),
  status: z.nativeEnum(ShipmentStatus),
});

export type BulkStatusUpdateInput = z.infer<typeof BulkStatusUpdateBodySchema>;

export const CreateShipmentBodySchema = z.object({
  trackingNumber: z.string().optional(),
  origin: z.string().min(1),
  destination: z.string().min(1),
  enterpriseId: z.string().min(1),
  logisticsId: z.string().min(1),
  offChainMetadata: z.record(z.unknown()).optional(),
});

export type CreateShipmentInput = z.infer<typeof CreateShipmentBodySchema>;

export const ShipmentIdParamSchema = z.object({
  id: z.string().min(1),
});

export const ShipmentPatchBodySchema = z.object({
  offChainMetadata: z.record(z.unknown()).optional(),
});

export const ShipmentStatusBodySchema = z.object({
  status: z.nativeEnum(ShipmentStatus),
  milestoneData: z.record(z.unknown()).optional(),
});

export type ShipmentStatusInput = z.infer<typeof ShipmentStatusBodySchema>;

export const ShipmentProofBodySchema = z.object({
  recipientSignatureName: z.string().optional(),
  notes: z.string().optional(),
});

export const ShipmentsQuerySchema = getShipmentsQuerySchema;

export const ExportShipmentsQuerySchema = z.object({
  format: z.enum(['csv', 'json']).default('json'),
  status: z.string().optional(),
  origin: z.string().optional(),
  destination: z.string().optional(),
  startDate: z.string().datetime({ offset: true }).optional(),
  endDate: z.string().datetime({ offset: true }).optional(),
});
export const ExportShipmentsQuerySchema = z
  .object({
    format: z.enum(['csv', 'json']).default('json'),
    status: z.string().optional(),
    origin: z.string().optional(),
    destination: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  })
  .strict();

export type ExportShipmentsQuery = z.infer<typeof ExportShipmentsQuerySchema>;
