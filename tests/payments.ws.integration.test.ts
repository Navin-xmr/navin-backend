import { jest, describe, expect, beforeAll, afterAll, it } from '@jest/globals';
import { io, Socket } from 'socket.io-client';
import { createServer, Server } from 'http';
import { signToken } from './fixtures/factories.js';
import { randomUUID } from 'crypto';
import { joinShipmentRoom, listenOnEphemeralPort, teardownSocketSuite, waitForSocketEvent } from './helpers/flush.js';
import { listenOnEphemeralPort, waitForSocketEvent } from './helpers/flush.js';
import { expectSettlementPayload } from './helpers/socketContract.js';
import { SOCKET_EVENTS } from '../src/shared/types/socketEvents.js';
import type { SettlementStatusPayload } from '../src/shared/types/socketEvents.js';

/** Amount carried by the settlement broadcast; asserted verbatim. */
const AMOUNT = 250;
/** Stellar transaction hash — asserted verbatim so lost propagation fails. */
const TX_HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff0011';

function settlementPayload(
  overrides: Partial<SettlementStatusPayload> = {}
): SettlementStatusPayload {
  return {
    paymentId: 'pay-1',
    shipmentId: '671000000000000000000099',
    oldStatus: 'PENDING',
    newStatus: 'RELEASED',
    amount: AMOUNT,
    txHash: TX_HASH,
    timestamp: '2026-07-24T21:00:00.000Z',
    ...overrides,
  };
}

describe('settlement:status socket event', () => {
  let httpServer: Server;
  let socketClient: Socket;
  let testPort: number;
  const SHIPMENT_ID = '671000000000000000000099';
  const OTHER_SHIPMENT_ID = '671000000000000000000098';

  beforeAll(async () => {
    await jest.unstable_mockModule('../src/modules/shipments/shipments.model.js', () => ({
      Shipment: {
        findById: jest.fn(() => ({
          select: jest.fn(() => ({
            lean: jest.fn(() => Promise.resolve({ enterpriseId: 'org456', logisticsId: 'org789' })),
          })),
        })),
      },
      ShipmentStatus: {},
    }));

    httpServer = createServer();
    const { initSocketIO } = await import('../src/infra/socket/io.js');
    initSocketIO(httpServer);

    testPort = await listenOnEphemeralPort(httpServer);

    const token = signToken({
      userId: 'user-1',
      role: 'ADMIN',
      organizationId: 'org456',
      jti: randomUUID(),
    });

    socketClient = io(`http://localhost:${testPort}`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      auth: { token },
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Socket client did not connect within 10 s')),
        10_000
      );
      socketClient.on('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socketClient.on('connect_error', err => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }, 30_000);

  afterAll(async () => {
    await teardownSocketSuite({ socketClient, httpServer });
  });

  it('subscribes the client to the shipment room named shipment_<id>', async () => {
    const joined = waitForSocketEvent<{ shipmentId: string; room: string }>(
      socketClient,
      'room_joined'
    );
    socketClient.emit('join_shipment', SHIPMENT_ID);
    const ack = await joined;

    expect(ack).toEqual({ shipmentId: SHIPMENT_ID, room: `shipment_${SHIPMENT_ID}` });
  }, 30_000);

  it('delivers the complete settlement payload to joined shipment room clients', async () => {
    // Listener must be registered before the emit, otherwise the broadcast races it.
    const eventPromise = waitForSocketEvent<unknown>(socketClient, SOCKET_EVENTS.SETTLEMENT_STATUS);

    const { emitPaymentStatusChange } = await import('../src/infra/socket/io.js');
    emitPaymentStatusChange(SHIPMENT_ID, settlementPayload());

    const eventPromise = waitForSocketEvent<Record<string, unknown>>(
      socketClient,
      'payment_status_changed',
      10_000
    );
    const received: SettlementStatusPayload = expectSettlementPayload(await eventPromise);

    // Full equality, not objectContaining: a dropped or renamed field fails here.
    expect(received).toEqual(settlementPayload());
    expect(received.paymentId).toBe('pay-1');
    expect(received.shipmentId).toBe(SHIPMENT_ID);
    expect(received.oldStatus).toBe('PENDING');
    expect(received.newStatus).toBe('RELEASED');
    expect(received.amount).toBe(AMOUNT);
    // Guard against a regression that stops propagating the Stellar tx hash.
    expect(received.txHash).toBe(TX_HASH);
    expect(received.timestamp).toBe('2026-07-24T21:00:00.000Z');
  }, 30_000);

  it('keeps txHash propagation covered when the transition is on-chain', async () => {
    const eventPromise = waitForSocketEvent<unknown>(socketClient, SOCKET_EVENTS.SETTLEMENT_STATUS);

    const { emitPaymentStatusChange } = await import('../src/infra/socket/io.js');
    const payload = settlementPayload({
      oldStatus: 'ESCROWED',
      newStatus: 'COMPLETED',
      amount: 4096.75,
      txHash: TX_HASH.toUpperCase(),
      timestamp: '2026-07-24T21:05:30.500Z',
    });
    emitPaymentStatusChange(SHIPMENT_ID, payload);

    const received: SettlementStatusPayload = expectSettlementPayload(await eventPromise);

    expect(received.txHash).toBe(TX_HASH.toUpperCase());
    expect(received.newStatus).toBe('COMPLETED');
    expect(received.amount).toBe(4096.75);
    expect(received.timestamp).toBe('2026-07-24T21:05:30.500Z');
  }, 30_000);

  it('omits txHash when the status transition is not on-chain', async () => {
    const eventPromise = waitForSocketEvent<unknown>(socketClient, SOCKET_EVENTS.SETTLEMENT_STATUS);

    const { emitPaymentStatusChange } = await import('../src/infra/socket/io.js');
    emitPaymentStatusChange(SHIPMENT_ID, {
      paymentId: 'pay-1',
      shipmentId: SHIPMENT_ID,
      oldStatus: 'PENDING',
      newStatus: 'DISPUTED',
      amount: AMOUNT,
      timestamp: '2026-07-24T21:10:00.000Z',
    });

    const received: SettlementStatusPayload = expectSettlementPayload(await eventPromise);

    expect(received.txHash).toBeUndefined();
    expect(received.newStatus).toBe('DISPUTED');
  }, 30_000);

  it('does not deliver settlement:status to clients outside the shipment room', async () => {
    const received: unknown[] = [];
    const listener = (payload: unknown) => {
      received.push(payload);
    };
    socketClient.on(SOCKET_EVENTS.SETTLEMENT_STATUS, listener);

    try {
      const { emitPaymentStatusChange } = await import('../src/infra/socket/io.js');
      emitPaymentStatusChange(
        OTHER_SHIPMENT_ID,
        settlementPayload({ shipmentId: OTHER_SHIPMENT_ID })
      );

      // Bounded race: a leaked delivery resolves as 'delivered' before the timer.
      const outcome = await Promise.race([
        new Promise<'delivered'>(resolve => {
          socketClient.once(SOCKET_EVENTS.SETTLEMENT_STATUS, () => resolve('delivered'));
        }),
        new Promise<'not-delivered'>(resolve => setTimeout(() => resolve('not-delivered'), 500)),
      ]);

      expect(outcome).toBe('not-delivered');
    } finally {
      socketClient.off(SOCKET_EVENTS.SETTLEMENT_STATUS, listener);
    }

    expect(received).toEqual([]);
  }, 30_000);
});
