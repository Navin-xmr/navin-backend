import type { Response } from 'express';
import type { Redis } from 'ioredis';
import { getRedisClient } from '../redis/connection.js';
import { logger } from '../../shared/logger/logger.js';
import {
  SSE_HEARTBEAT_INTERVAL_MS,
  userSseChannel,
  type RealtimeEvent,
} from '../../shared/types/realtimeEvents.js';

interface SseClient {
  res: Response;
  heartbeatTimer: ReturnType<typeof setInterval>;
}

const clientsByUser = new Map<string, Set<SseClient>>();

let subscriber: Redis | null = null;
let publisher: Redis | null = null;
let redisPubSubReady = false;

function formatSseMessage(event: RealtimeEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function writeHeartbeat(res: Response): void {
  if (!res.writableEnded) {
    res.write(': heartbeat\n\n');
  }
}

function deliverToLocalClients(userId: string, event: RealtimeEvent): void {
  const clients = clientsByUser.get(userId);
  if (!clients || clients.size === 0) {
    return;
  }

  const payload = formatSseMessage(event);
  for (const client of clients) {
    if (!client.res.writableEnded) {
      client.res.write(payload);
    }
  }
}

function removeClient(userId: string, client: SseClient): void {
  clearInterval(client.heartbeatTimer);

  const clients = clientsByUser.get(userId);
  if (!clients) {
    return;
  }

  clients.delete(client);
  if (clients.size === 0) {
    clientsByUser.delete(userId);
  }
}

function handleRedisMessage(channel: string, message: string): void {
  const prefix = 'sse:user:';
  if (!channel.startsWith(prefix)) {
    return;
  }

  const userId = channel.slice(prefix.length);
  try {
    const event = JSON.parse(message) as RealtimeEvent;
    deliverToLocalClients(userId, event);
  } catch (err) {
    logger.error({ err, channel }, 'Failed to parse SSE Redis message');
  }
}

/**
 * Initializes Redis pub/sub bridge for cross-instance SSE fan-out.
 * Falls back to in-process delivery when Redis pub/sub is unavailable.
 */
export async function initSseHub(): Promise<void> {
  if (redisPubSubReady) {
    return;
  }

  try {
    publisher = getRedisClient();
    subscriber = publisher.duplicate();

    subscriber.on('message', handleRedisMessage);

    await subscriber.subscribe('sse:user:__init__');
    await subscriber.unsubscribe('sse:user:__init__');

    redisPubSubReady = true;
    logger.info('SSE hub Redis pub/sub initialized');
  } catch (err) {
    redisPubSubReady = false;
    logger.warn({ err }, 'SSE hub using in-memory fan-out only (Redis pub/sub unavailable)');
  }
}

/**
 * Publishes a realtime event to all SSE connections for the given user.
 */
export function publishToUser(userId: string, event: RealtimeEvent): void {
  if (redisPubSubReady && publisher) {
    void publisher.publish(userSseChannel(userId), JSON.stringify(event)).catch(err => {
      logger.error({ err, userId }, 'Redis SSE publish failed; falling back to local delivery');
      deliverToLocalClients(userId, event);
    });
    return;
  }

  deliverToLocalClients(userId, event);
}

/**
 * Registers an Express response as an SSE stream for a user.
 * Sends heartbeats every 30 seconds until the client disconnects.
 */
export function registerSseClient(userId: string, res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  res.write(': connected\n\n');
  writeHeartbeat(res);

  const heartbeatTimer = setInterval(() => {
    writeHeartbeat(res);
  }, SSE_HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref();

  const client: SseClient = { res, heartbeatTimer };
  const existing = clientsByUser.get(userId);
  if (existing) {
    existing.add(client);
  } else {
    clientsByUser.set(userId, new Set([client]));
  }

  res.on('close', () => {
    removeClient(userId, client);
  });
}

/**
 * Closes all SSE connections and tears down Redis pub/sub.
 */
export async function closeSseHub(): Promise<void> {
  for (const [userId, clients] of clientsByUser.entries()) {
    for (const client of clients) {
      clearInterval(client.heartbeatTimer);
      if (!client.res.writableEnded) {
        client.res.end();
      }
      removeClient(userId, client);
    }
  }
  clientsByUser.clear();

  if (subscriber) {
    subscriber.removeAllListeners('message');
    await subscriber.quit();
    subscriber = null;
  }

  publisher = null;
  redisPubSubReady = false;
}

/** @internal Exposed for unit tests */
export function getSseClientCount(userId?: string): number {
  if (userId) {
    return clientsByUser.get(userId)?.size ?? 0;
  }

  let total = 0;
  for (const clients of clientsByUser.values()) {
    total += clients.size;
  }
  return total;
}

/** @internal Exposed for unit tests */
export function deliverToUserForTest(userId: string, event: RealtimeEvent): void {
  deliverToLocalClients(userId, event);
}

/** @internal Exposed for unit tests */
export function isRedisPubSubReady(): boolean {
  return redisPubSubReady;
}

/** @internal Exposed for unit tests — bypasses Redis for direct local writes */
export function resetSseHubForTest(): void {
  for (const clients of clientsByUser.values()) {
    for (const client of clients) {
      clearInterval(client.heartbeatTimer);
    }
  }
  clientsByUser.clear();
  redisPubSubReady = false;
  subscriber = null;
  publisher = null;
}
