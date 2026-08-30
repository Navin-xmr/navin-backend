import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createHmac } from 'crypto';
import request from 'supertest';
import type { Application } from 'express';

const STELLAR_WEBHOOK_SECRET = 'test-stellar-webhook-secret-key';

describe('POST /api/webhooks/stellar', () => {
  const payload = {
    id: 'evt_1',
    type: 'release' as const,
    paymentId: '507f1f77bcf86cd799439011',
    transactionHash: 'abc123def456',
    amount: 100,
    timestamp: '2026-01-15T12:30:00.000Z',
  };

  let app: Application;
  const mockHandleStellarWebhookEvent =
    jest.fn<(...args: unknown[]) => Promise<Record<string, unknown>>>();

  function signBody(body: object): string {
    return createHmac('sha256', STELLAR_WEBHOOK_SECRET).update(JSON.stringify(body)).digest('hex');
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.resetModules();

    process.env.STELLAR_WEBHOOK_SECRET = STELLAR_WEBHOOK_SECRET;

    mockHandleStellarWebhookEvent.mockResolvedValue({
      event: 'release',
      paymentId: payload.paymentId,
      status: 'RELEASED',
      transactionHash: payload.transactionHash,
    });

    await jest.unstable_mockModule('../src/modules/webhooks/stellar.webhook.service.js', () => ({
      handleStellarWebhookEvent: mockHandleStellarWebhookEvent,
    }));

    await jest.unstable_mockModule('../src/services/stellar.service.js', () => ({
      tokenizeShipment: jest.fn(),
      anchorTelemetryHash: jest.fn(),
      releaseEscrow: jest.fn(),
      getStellarExplorerUrl: jest.fn(() => 'https://stellar.expert/explorer/testnet/tx/mock'),
    }));

    await jest.unstable_mockModule('../src/infra/socket/io.js', () => ({
      initSocketIO: jest.fn(),
      getIO: jest.fn(),
      emitAnomalyDetected: jest.fn(),
      emitTelemetryUpdate: jest.fn(),
      emitPaymentStatusChange: jest.fn(),
      emitStatusUpdate: jest.fn(),
    }));

    await jest.unstable_mockModule('../src/infra/redis/queue.js', () => ({
      pushAlertJob: jest.fn(),
      pushStellarAnchorJob: jest.fn(),
      getTransactionQueue: jest.fn(),
      getRedisClient: jest.fn(),
    }));

    const appModule = await import('../src/app.js');
    app = appModule.buildApp();
  });

  it('returns 401 when x-stellar-signature header is missing', async () => {
    const res = await request(app).post('/api/webhooks/stellar').send(payload);

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/signature/i);
    expect(mockHandleStellarWebhookEvent).not.toHaveBeenCalled();
  });

  it('returns 401 when x-stellar-signature is invalid', async () => {
    const res = await request(app)
      .post('/api/webhooks/stellar')
      .set('x-stellar-signature', 'deadbeef'.repeat(8))
      .send(payload);

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/signature/i);
    expect(mockHandleStellarWebhookEvent).not.toHaveBeenCalled();
  });

  it('processes a valid signed request', async () => {
    const signature = signBody(payload);

    const res = await request(app)
      .post('/api/webhooks/stellar')
      .set('x-stellar-signature', signature)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockHandleStellarWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: payload.id,
        type: payload.type,
        paymentId: payload.paymentId,
      })
    );
  });
});

describe('verifyStellarSignature middleware', () => {
  it('rejects missing signature and accepts a matching HMAC', async () => {
    jest.resetModules();
    process.env.STELLAR_WEBHOOK_SECRET = STELLAR_WEBHOOK_SECRET;

    const { verifyStellarSignature } =
      await import('../src/shared/middleware/verifyStellarSignature.js');

    const raw = Buffer.from(JSON.stringify({ ok: true }));
    const goodSig = createHmac('sha256', STELLAR_WEBHOOK_SECRET).update(raw).digest('hex');

    const missingNext = jest.fn();
    expect(() =>
      verifyStellarSignature({ headers: {}, rawBody: raw } as never, {} as never, missingNext)
    ).toThrow(/Missing X-Stellar-Signature/);
    expect(missingNext).not.toHaveBeenCalled();

    const okNext = jest.fn();
    verifyStellarSignature(
      { headers: { 'x-stellar-signature': goodSig }, rawBody: raw } as never,
      {} as never,
      okNext
    );
    expect(okNext).toHaveBeenCalled();
  });
});
