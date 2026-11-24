import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createHmac } from 'node:crypto';

const subscriptionFindOne =
  jest.fn<
    (...args: unknown[]) => { select: (fields: string) => { lean: () => Promise<unknown> } }
  >();
const subscriptionLean = jest.fn<() => Promise<unknown>>();
const subscriptionSelect = jest.fn<(fields: string) => { lean: typeof subscriptionLean }>();
const originalEncryptionKey = process.env.CHAIN_WEBHOOK_ENCRYPTION_KEY;
const postRequestMock =
  jest.fn<(endpoint: string, body: string, headers: Record<string, string>) => Promise<number>>();
let deliverChainWebhook: typeof import('../src/modules/webhooks/chainWebhook.service.js').deliverChainWebhook;
let encryptChainWebhookSecret: typeof import('../src/modules/webhooks/chainWebhook.crypto.js').encryptChainWebhookSecret;

const webhookJob = {
  subscriptionId: '507f1f77bcf86cd799439011',
  eventId: '0002200479567253504-0000000001',
  payload: {
    eventId: '0002200479567253504-0000000001',
    eventName: 'anchor' as const,
    shipmentReference: 'NVN-123456',
    txHash: 'a'.repeat(64),
    ledger: 42,
    schemaVersion: 1 as const,
    occurredAt: '2026-09-27T10:15:30Z',
    dataHash: 'b'.repeat(64),
  },
};

describe('chain webhook delivery', () => {
  beforeEach(async () => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.CHAIN_WEBHOOK_ENCRYPTION_KEY = 'ab'.repeat(32);

    await jest.unstable_mockModule('../src/modules/webhooks/chainWebhook.model.js', () => ({
      ChainWebhookSubscriptionModel: {
        findOne: subscriptionFindOne,
      },
    }));
    await jest.unstable_mockModule('../src/modules/shipments/shipments.model.js', () => ({
      Shipment: {},
    }));
    await jest.unstable_mockModule('../src/infra/redis/queue.js', () => ({
      pushChainWebhookJob: jest.fn(),
    }));
    await jest.unstable_mockModule('../src/modules/webhooks/chainWebhook.transport.js', () => ({
      postChainWebhookRequest: postRequestMock,
    }));

    const crypto = await import('../src/modules/webhooks/chainWebhook.crypto.js');
    encryptChainWebhookSecret = crypto.encryptChainWebhookSecret;
    subscriptionLean.mockResolvedValue({
      endpoint: 'https://subscriber.example.test/navin',
      secretEncrypted: encryptChainWebhookSecret('subscriber-secret'),
    });
    subscriptionSelect.mockReturnValue({ lean: subscriptionLean });
    subscriptionFindOne.mockReturnValue({ select: subscriptionSelect });

    const service = await import('../src/modules/webhooks/chainWebhook.service.js');
    deliverChainWebhook = service.deliverChainWebhook;
  });

  afterEach(() => {
    if (originalEncryptionKey === undefined) {
      delete process.env.CHAIN_WEBHOOK_ENCRYPTION_KEY;
    } else {
      process.env.CHAIN_WEBHOOK_ENCRYPTION_KEY = originalEncryptionKey;
    }
  });

  it('sends the versioned payload with a signature over the exact timestamp and raw body', async () => {
    postRequestMock.mockResolvedValue(204);

    await deliverChainWebhook(webhookJob);

    const [endpoint, body, headers] = postRequestMock.mock.calls[0] ?? [];
    expect(endpoint).toBe('https://subscriber.example.test/navin');
    expect(body).toBe(JSON.stringify(webhookJob.payload));
    const timestamp = headers?.['x-navin-timestamp'];
    expect(timestamp).toMatch(/^\d+$/);
    expect(headers?.['x-navin-event-id']).toBe(webhookJob.eventId);
    const expected = createHmac('sha256', 'subscriber-secret')
      .update(`${timestamp}.${body}`)
      .digest('hex');
    expect(headers?.['x-navin-signature']).toBe(`sha256=${expected}`);
  });

  it('throws on non-2xx responses so BullMQ retries the delivery', async () => {
    postRequestMock.mockResolvedValue(503);

    await expect(deliverChainWebhook(webhookJob)).rejects.toMatchObject({
      statusCode: 502,
      code: 'ERR_WEBHOOKS_DELIVERY_FAILED',
    });
  });

  it('uses exponential retries and retains terminal failures for dead-lettering', async () => {
    const { CHAIN_WEBHOOK_RETRY_POLICY } = await import('../src/shared/types/chainWebhook.js');

    expect(CHAIN_WEBHOOK_RETRY_POLICY).toEqual({
      attempts: 8,
      backoff: { type: 'exponential', delay: 1000 },
    });
  });
});
