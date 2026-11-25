/**
 * Decodes raw Soroban RPC event ScVals into the spec's JSON event shape (#1043).
 *
 * Only the delivery events are decoded here. Their on-chain layout (navin-contracts
 * `events.rs`): topic `(Symbol(name),)`, data
 * `(shipment_id: u64, status: ShipmentStatus, data_hash: BytesN<32>, delivery_time: u64, actor: Address)`.
 * `ShipmentStatus` is a unit-variant enum → ScVal `vec[Symbol]`; u64 → bigint → decimal string.
 * The result is still untrusted: callers must run it through `parseChainEvent`.
 */
import { scValToNative } from '@stellar/stellar-sdk';
import type { xdr } from '@stellar/stellar-sdk';

import { CHAIN_EVENT_NAMES } from '../../shared/types/chain.js';

const DELIVERY_NAMES: ReadonlySet<string> = new Set([
  CHAIN_EVENT_NAMES.DELIVERY_SUCCESS,
  CHAIN_EVENT_NAMES.DELIVERY_CONFIRMED,
]);

export interface DecodedEventParts {
  name: string;
  topic: string[];
  data: unknown[];
}

function unitEnumName(value: unknown): unknown {
  return Array.isArray(value) && value.length === 1 ? value[0] : value;
}

/** Returns null for any event that is not a delivery event or cannot be decoded. */
export function decodeDeliveryEvent(raw: {
  topic?: xdr.ScVal[];
  value?: xdr.ScVal;
}): DecodedEventParts | null {
  try {
    if (!raw.topic?.[0] || !raw.value) return null;
    const name = scValToNative(raw.topic[0]);
    if (typeof name !== 'string' || !DELIVERY_NAMES.has(name)) return null;

    const native = scValToNative(raw.value) as unknown;
    if (!Array.isArray(native) || native.length !== 5) return null;
    const [shipmentId, status, dataHash, deliveryTime, actor] = native as unknown[];

    return {
      name,
      topic: raw.topic.map(t => String(scValToNative(t))),
      data: [
        typeof shipmentId === 'bigint' ? shipmentId.toString() : shipmentId,
        unitEnumName(status),
        Buffer.isBuffer(dataHash) || dataHash instanceof Uint8Array
          ? Buffer.from(dataHash).toString('hex')
          : dataHash,
        typeof deliveryTime === 'bigint' ? deliveryTime.toString() : deliveryTime,
        actor,
      ],
    };
  } catch {
    return null;
  }
}
