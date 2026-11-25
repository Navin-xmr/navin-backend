/**
 * ScVal → JS decoders for shipment-contract read results (P12-14).
 *
 * Each decoder checks the ScVal's type before converting, so a contract that
 * returns something unexpected fails loudly with ERR_CHAIN_UNKNOWN instead of
 * leaking a wrongly-typed value to callers.
 */
import { scValToNative, xdr } from '@stellar/stellar-sdk';

import { AppError, ErrorCodes } from '../../shared/http/errors.js';
import { CHAIN_SHIPMENT_STATUSES } from './types.js';
import type { ChainShipmentRecord, ChainShipmentStatus } from './types.js';

function decodeError(expected: string, value: xdr.ScVal): AppError {
  return new AppError(
    502,
    `Unexpected contract return value: expected ${expected}, got ${value.switch().name}`,
    ErrorCodes.CHAIN_UNKNOWN
  );
}

export function decodeU32(value: xdr.ScVal): number {
  if (value.switch() !== xdr.ScValType.scvU32()) throw decodeError('u32', value);
  return value.u32();
}

export function decodeI128(value: xdr.ScVal): bigint {
  if (value.switch() !== xdr.ScValType.scvI128()) throw decodeError('i128', value);
  return scValToNative(value) as bigint;
}

export function decodeAddress(value: xdr.ScVal): string {
  if (value.switch() !== xdr.ScValType.scvAddress()) throw decodeError('address', value);
  return scValToNative(value) as string;
}

/**
 * Soroban encodes a unit enum variant as a one-element vec holding its name
 * symbol, e.g. `ShipmentStatus::InTransit` → `Vec[Symbol("InTransit")]`.
 */
export function decodeShipmentStatus(value: xdr.ScVal): ChainShipmentStatus {
  const items = value.switch() === xdr.ScValType.scvVec() ? value.vec() : null;
  const tag = items?.length === 1 ? items[0] : undefined;
  if (!tag || tag.switch() !== xdr.ScValType.scvSymbol()) {
    throw decodeError('ShipmentStatus enum', value);
  }
  const name = tag.sym().toString();
  if (!(CHAIN_SHIPMENT_STATUSES as readonly string[]).includes(name)) {
    throw new AppError(502, `Unknown ShipmentStatus variant: ${name}`, ErrorCodes.CHAIN_UNKNOWN);
  }
  return name as ChainShipmentStatus;
}

/**
 * Decode a contract `Option<T>`: `None` is `ScVal::Void` and becomes `null`;
 * `Some(x)` is `x` itself and goes through `decodeSome`.
 */
export function decodeOption<T>(value: xdr.ScVal, decodeSome: (v: xdr.ScVal) => T): T | null {
  return value.switch() === xdr.ScValType.scvVoid() ? null : decodeSome(value);
}

/**
 * `Shipment` struct (an ScMap keyed by field-name symbols) → plain object.
 * `Option::None` fields (`ScVal::Void`) come out as `null`.
 */
export function decodeShipment(value: xdr.ScVal): ChainShipmentRecord {
  if (value.switch() !== xdr.ScValType.scvMap()) throw decodeError('Shipment struct', value);
  return Object.freeze(scValToNative(value) as Record<string, unknown>);
}
