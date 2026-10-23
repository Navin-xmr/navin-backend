import type { Response } from 'express';

import { getRedisClient } from '../redis/connection.js';
import { logger } from '../../shared/logger/logger.js';
import {
  SSE_HEARTBEAT_INTERVAL_MS,
  userSseChannel,
  type RealtimeEvent,
} from '../../shared/types/realtimeEvents.js';

import { sseHubState, type SseClient, type SseStreamResponse } from './sseHubState.js';

function formatSseMessage(event: RealtimeEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function writeHeartbeat(res: SseStreamResponse): void {
  if (!res.writableEnded) {
    res.write(': heartbeat\n\n');
  }
}

function deliverToLocalClients(userId: string, event: RealtimeEvent): void {
  const clients = sseHubState.clientsByUser.get(userId);
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

  const clients = sseHubState.clientsByUser.get(userId);
  if (!clients) {
    return;
  }

  clients.delete(client);
  if (clients.size === 0) {
    sseHubState.clientsByUser.delete(userId);
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
  if (sseHubState.redisPubSubReady) {
    return;
  }

  try {
    const publisher = getRedisClient();
    const subscriber = publisher.duplicate();
    sseHubState.publisher = publisher;
    sseHubState.subscriber = subscriber;

    subscriber.on('message', handleRedisMessage);

    await subscriber.subscribe('sse:user:__init__');
    await subscriber.unsubscribe('sse:user:__init__');

    sseHubState.redisPubSubReady = true;
    logger.info('SSE hub Redis pub/sub initialized');
  } catch (err) {
    sseHubState.redisPubSubReady = false;
    logger.warn({ err }, 'SSE hub using in-memory fan-out only (Redis pub/sub unavailable)');
  }
}

/**
 * Publishes a realtime event to all SSE connections for the given user.
 */
export function publishToUser(userId: string, event: RealtimeEvent): void {
  const publisher = sseHubState.publisher;
  if (sseHubState.redisPubSubReady && publisher) {
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
  const sseRes = res as SseStreamResponse;

  sseRes.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  sseRes.write(': connected\n\n');
  writeHeartbeat(sseRes);

  const heartbeatTimer = setInterval(() => {
    writeHeartbeat(sseRes);
  }, SSE_HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref();

  const client: SseClient = { res: sseRes, heartbeatTimer };
  const existing = sseHubState.clientsByUser.get(userId);
  if (existing) {
    existing.add(client);
  } else {
    sseHubState.clientsByUser.set(userId, new Set([client]));
  }

  sseRes.on('close', () => {
    removeClient(userId, client);
  });
}

/**
 * Closes all SSE connections and tears down Redis pub/sub.
 */
export async function closeSseHub(): Promise<void> {
  for (const [userId, clients] of sseHubState.clientsByUser.entries()) {
    for (const client of clients) {
      clearInterval(client.heartbeatTimer);
      if (!client.res.writableEnded) {
        client.res.end();
      }
      removeClient(userId, client);
    }
  }
  sseHubState.clientsByUser.clear();

  const subscriber = sseHubState.subscriber;
  if (subscriber) {
    subscriber.removeAllListeners('message');
    await subscriber.quit();
    sseHubState.subscriber = null;
  }

  sseHubState.publisher = null;
  sseHubState.redisPubSubReady = false;
}
