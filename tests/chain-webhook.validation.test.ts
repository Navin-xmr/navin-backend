import { describe, expect, it } from '@jest/globals';
import { CreateChainWebhookSubscriptionSchema } from '../src/modules/webhooks/chainWebhook.validation.js';

describe('chain webhook subscription validation', () => {
  it.each(['https://[::1]/hook', 'https://[2606:4700:4700::1111]/hook'])(
    'rejects IPv6 literal endpoint %s',
    endpoint => {
      expect(
        CreateChainWebhookSubscriptionSchema.safeParse({
          endpoint,
          events: ['anchor'],
        }).success
      ).toBe(false);
    }
  );
});
