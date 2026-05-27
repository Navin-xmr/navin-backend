import { z } from 'zod';

export const ShipmentProofBodySchema = z.object({
  recipientSignatureName: z.string().optional(),
  notes: z.string().optional(),
});
