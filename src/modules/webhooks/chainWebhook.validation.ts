import { isIP } from 'node:net';
import { z } from 'zod';
import { CHAIN_EVENT_NAMES } from '../../shared/types/chain.js';

function isAllowedEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      hostname !== 'localhost' &&
      !hostname.endsWith('.localhost') &&
      !hostname.endsWith('.local') &&
      isIP(hostname) === 0
    );
  } catch {
    return false;
  }
}

export const CreateChainWebhookSubscriptionSchema = z
  .object({
    endpoint: z.string().url().refine(isAllowedEndpoint, 'endpoint must be a public HTTPS URL'),
    events: z
      .array(z.nativeEnum(CHAIN_EVENT_NAMES))
      .min(1)
      .max(3)
      .refine(events => new Set(events).size === events.length, 'events must be unique'),
  })
  .strict();

export const ChainWebhookSubscriptionIdSchema = z.object({
  subscriptionId: z.string().regex(/^[0-9a-fA-F]{24}$/),
});

export type CreateChainWebhookSubscription = z.infer<typeof CreateChainWebhookSubscriptionSchema>;
