import { getRedisClient } from '../../infra/redis/connection.js';

const SHIPMENT_ETA_CACHE_PREFIX = 'shipments:eta:';
const SHIPMENT_ETA_CACHE_TTL_SECONDS = 300;

let redisUnavailable = false;

type EtaConfidence = 'LOW' | 'MEDIUM' | 'HIGH';

export type ShipmentEtaPayload =
  | {
      estimatedArrival: string;
      distanceRemaining: number;
      averageSpeed: number;
      confidence: EtaConfidence;
    }
  | {
      estimatedArrival: null;
      reason: string;
    };

type RedisLike = {
  get: (key: string) => Promise<string | null>;
  set: (...args: unknown[]) => Promise<unknown>;
  del: (...keys: string[]) => Promise<number>;
};

function getCacheClient(): RedisLike | null {
  if (redisUnavailable) {
    return null;
  }

  try {
    return getRedisClient() as unknown as RedisLike;
  } catch {
    redisUnavailable = true;
    return null;
  }
}

export function shipmentEtaCacheKey(shipmentId: string): string {
  return `${SHIPMENT_ETA_CACHE_PREFIX}${shipmentId}`;
}

export async function readShipmentEtaCache(shipmentId: string): Promise<ShipmentEtaPayload | null> {
  const client = getCacheClient();
  if (!client) {
    return null;
  }

  try {
    const value = await client.get(shipmentEtaCacheKey(shipmentId));
    if (!value) {
      return null;
    }

    return JSON.parse(value) as ShipmentEtaPayload;
  } catch {
    redisUnavailable = true;
    return null;
  }
}

export async function writeShipmentEtaCache(
  shipmentId: string,
  payload: ShipmentEtaPayload
): Promise<void> {
  const client = getCacheClient();
  if (!client) {
    return;
  }

  try {
    await client.set(
      shipmentEtaCacheKey(shipmentId),
      JSON.stringify(payload),
      'EX',
      SHIPMENT_ETA_CACHE_TTL_SECONDS
    );
  } catch {
    redisUnavailable = true;
  }
}

export async function invalidateShipmentEtaCache(shipmentId: string): Promise<void> {
  const client = getCacheClient();
  if (!client) {
    return;
  }

  try {
    await client.del(shipmentEtaCacheKey(shipmentId));
  } catch {
    redisUnavailable = true;
  }
}
