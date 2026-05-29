import { z } from 'zod';
import { ShipmentStatus } from './shipments.model.js';
import { ShipmentStatus } from '../../shared/constants/shipments.js';

export const getShipmentsQuerySchema = z.object({
  status: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  origin: z.string().optional(),
  destination: z.string().optional(),
});

export type GetShipmentsQuery = z.infer<typeof getShipmentsQuerySchema>;

export const CreateShipmentBodySchema = z.object({
  trackingNumber: z.string().optional(),
  origin: z.string().min(1),
  destination: z.string().min(1),
  enterpriseId: z.string().optional(),
  logisticsId: z.string().optional(),
export const CreateShipmentBodySchema = z.object({
  trackingNumber: z.string().min(1),
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
  offChainMetadata: z.record(z.unknown()),
});

export const ShipmentStatusBodySchema = z.object({
  status: z.string().min(1),
  trackingNumber: z.string().min(1).optional(),
  origin: z.string().min(1).optional(),
  destination: z.string().min(1).optional(),
  status: z.string().optional(),
  offChainMetadata: z.record(z.unknown()).optional(),
});

export const ShipmentProofBodySchema = z.object({
  recipientSignatureName: z.string().optional(),
  notes: z.string().optional(),
});

// Alias for backward compatibility
export const ShipmentsQuerySchema = getShipmentsQuerySchema;
export const ShipmentsQuerySchema = getShipmentsQuerySchema;

export const ShipmentStatusBodySchema = z.object({
  status: z
    .enum([
      ShipmentStatus.CREATED,
      ShipmentStatus.IN_TRANSIT,
      ShipmentStatus.DELIVERED,
      ShipmentStatus.CANCELLED,
    ])
    .describe('Shipment status'),
  milestoneData: z.record(z.unknown()).optional(),
});
