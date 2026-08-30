import { jest, describe, expect, beforeAll, afterAll, it } from '@jest/globals';
import { io, Socket } from 'socket.io-client';
import { createServer, Server } from 'http';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

describe('payment_status_changed socket event', () => {
  let httpServer: Server;
  let socketClient: Socket;
  const TEST_PORT = 3998;
  const SHIPMENT_ID = '671000000000000000000099';

  beforeAll(async () => {
    await jest.unstable_mockModule('../src/modules/shipments/shipments.model.js', () => ({
      Shipment: {
        findById: jest.fn(() => ({
          select: jest.fn(() => ({
            lean: jest.fn(() =>
              Promise.resolve({ enterpriseId: 'org456', logisticsId: 'org789' })
            ),
          })),
        })),
      },
      ShipmentStatus: {},
    }));

    httpServer = createServer();
    const { initSocketIO } = await import('../src/infra/socket/io.js');
    initSocketIO(httpServer);

    await new Promise<void>(resolve => {
      httpServer.listen(TEST_PORT, () => resolve());
    });

    const token = jwt.sign(
      {
        userId: 'user-1',
        role: 'ADMIN',
        organizationId: 'org456',
        jti: randomUUID(),
      },
      process.env.JWT_SECRET!
    );

    socketClient = io(`http://localhost:${TEST_PORT}`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      auth: { token },
    });

    await new Promise<void>(resolve => {
      socketClient.on('connect', () => resolve());
    });
  }, 30_000);

  afterAll(async () => {
    if (socketClient?.connected) socketClient.disconnect();
    const { closeSocketIO } = await import('../src/infra/socket/io.js');
    await closeSocketIO();
    if (httpServer) {
      await new Promise<void>(resolve => httpServer.close(() => resolve()));
    }
  });

  it('delivers payment_status_changed to joined shipment room clients', async () => {
    socketClient.emit('join_shipment', SHIPMENT_ID);
    await new Promise(resolve => setTimeout(resolve, 150));

    const eventPromise = new Promise<Record<string, unknown>>(resolve => {
      socketClient.on('payment_status_changed', payload => resolve(payload));
    });

    const { emitPaymentStatusChange } = await import('../src/infra/socket/io.js');
    emitPaymentStatusChange(SHIPMENT_ID, {
      paymentId: 'pay-1',
      shipmentId: SHIPMENT_ID,
      oldStatus: 'Pending',
      newStatus: 'Released',
      amount: 250,
      timestamp: '2026-07-24T21:00:00.000Z',
    });

    const payload = await eventPromise;
    expect(payload).toMatchObject({
      paymentId: 'pay-1',
      shipmentId: SHIPMENT_ID,
      oldStatus: 'Pending',
      newStatus: 'Released',
      amount: 250,
    });
  });
});
