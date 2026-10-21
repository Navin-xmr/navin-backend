/**
 * Deterministic async synchronisation helpers for tests (#614).
 *
 * Prefer these over fixed `setTimeout` sleeps: they wait for work that is
 * actually queued rather than guessing how long it takes.
 */
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import type { Socket } from 'socket.io-client';

/**
 * Drains the microtask queue and pending `setImmediate` callbacks, repeating
 * until `rounds` consecutive macrotask turns have passed. This lets chained
 * fire-and-forget work (`setImmediate(() => promise.then(...))`) settle.
 */
export async function flushUntilIdle(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise<void>(resolve => setImmediate(resolve));
  }
}

/** Starts `server` on an OS-assigned port (`port: 0`) and resolves the port. */
export function listenOnEphemeralPort(server: Server): Promise<number> {
  return new Promise(resolve => {
    server.listen({ port: 0 }, () => resolve((server.address() as AddressInfo).port));
  });
}

/**
 * Resolves with the first payload the client receives for `event`, or rejects
 * after `timeoutMs` if the event never arrives. This prevents a missed event
 * from hanging a test until Jest's global timeout forces the worker to exit.
 */
export function waitForSocketEvent<T = unknown>(
  socket: Socket,
  event: string,
  timeoutMs = 5_000
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for socket event "${event}" after ${timeoutMs}ms`));
    }, timeoutMs);

    function handler(payload: T) {
      clearTimeout(timer);
      resolve(payload);
    }

    socket.once(event, handler);
  });
}

/**
 * Disconnects a socket.io-client and awaits the server-acknowledged disconnect
 * event so callers can be sure no open handle remains before closing the server.
 */
export function disconnectClient(socket: Socket, timeoutMs = 5_000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (!socket.connected) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      reject(new Error(`Socket did not disconnect within ${timeoutMs}ms`));
    }, timeoutMs);

    socket.once('disconnect', () => {
      clearTimeout(timer);
      resolve();
    });

    socket.disconnect();
  });
}

/**
 * Full teardown sequence for a Socket.IO integration suite.
 * Order matters: client must be gone before the server closes so that
 * closeSocketIO() doesn't race against an in-flight disconnect.
 */
export async function teardownSocketSuite(params: {
  socketClient: Socket | undefined;
  httpServer: Server | undefined;
}): Promise<void> {
  const { socketClient, httpServer } = params;

  if (socketClient) {
    await disconnectClient(socketClient).catch(() => {
      // Forcibly disconnect if the graceful await times out.
      socketClient.disconnect();
    });
  }

  try {
    const { closeSocketIO } = await import('../../src/infra/socket/io.js');
    await closeSocketIO();
  } catch {
    // Module may have been mocked — nothing to close.
  }

  if (httpServer?.listening) {
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err?: Error) => (err ? reject(err) : resolve()));
    });
  }
}

/** Emits `join_shipment` and awaits the server's `room_joined` acknowledgement. */
export async function joinShipmentRoom(socket: Socket, shipmentId: string): Promise<void> {
  const joined = waitForSocketEvent(socket, 'room_joined');
  socket.emit('join_shipment', shipmentId);
  await joined;
}
