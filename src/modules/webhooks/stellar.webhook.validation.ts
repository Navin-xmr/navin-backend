import { z } from 'zod';

export const StellarWebhookPayloadSchema = z.object({
  id: z.string(),
  type: z.enum(['release', 'escrow', 'failed']),
  paymentId: z.string(),
  transactionHash: z.string(),
  amount: z.number(),
  timestamp: z.string().datetime(),
  signature: z.string().optional(),
});

export const StellarWebhookHeadersSchema = z.object({
  'x-stellar-signature': z.string().min(1, 'x-stellar-signature header is required'),
});

export type StellarWebhookPayload = z.infer<typeof StellarWebhookPayloadSchema>;
export type StellarWebhookHeaders = z.infer<typeof StellarWebhookHeadersSchema>;
