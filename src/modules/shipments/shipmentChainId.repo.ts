import { Types } from 'mongoose';
import { Shipment } from './shipments.model.js';
import {
  ShipmentChainId,
  type ChainNetwork,
  type IShipmentChainId,
} from './shipmentChainId.model.js';
import { ShipmentChainIdSequence } from './shipmentChainIdSequence.model.js';
import { AppError, ErrorCodes } from '../../shared/http/errors.js';
import { U64StringSchema } from '../../shared/types/chain.js';

/** One MongoDB shipment ↔ one on-chain `u64` shipment id, scoped to a deployment. */
export interface ShipmentChainIdMapping {
  /** MongoDB `_id` of the shipment (24-char hex) — the backend identity. */
  shipmentId: string;
  /** Contract `u64` shipment id as a canonical decimal string (`UpdateStatusArgs.shipment_id`). */
  chainShipmentId: string;
  /** Deployment the id was allocated on. */
  network: ChainNetwork;
  /** Allocation time, ISO 8601 UTC. Allocations are permanent. */
  allocatedAt: string;
}

/** Lookup key for the mapping — a mapping is 1:1 per `(network, shipmentId)`. */
export interface ShipmentChainIdLookup {
  shipmentId: string;
  network: ChainNetwork;
}

/**
 * Repository seam for the ObjectId ↔ on-chain `u64` mapping (P11-10,
 * `docs/adr-objectid-chain-shipment-id.md`). Callers depend on this interface,
 * never on the models or on the raw sequence.
 */
export interface ShipmentChainIdRepository {
  /** Existing mapping, or `null` when the shipment has no on-chain id yet. Never allocates. */
  read(input: ShipmentChainIdLookup): Promise<ShipmentChainIdMapping | null>;
  /**
   * Idempotent read-or-allocate. Rejects with `ERR_SHIPMENT_NOT_FOUND` when the
   * shipment row is missing or soft-deleted, so an id is never minted for a
   * shipment that does not exist.
   */
  allocate(input: ShipmentChainIdLookup): Promise<ShipmentChainIdMapping>;
}

/** `chainShipmentId` collisions tolerated before allocation gives up. */
export const MAX_ALLOCATION_ATTEMPTS = 5;

/**
 * Prefix for the `Symbol` derived for `anchor` / `init_escrow` / `release_escrow`,
 * which still declare `shipment_id: Symbol`. `nv_` plus a 20-digit `u64` is 23
 * characters, inside the `[A-Za-z0-9_]{1,32}` Symbol limit.
 */
export const CHAIN_SHIPMENT_ID_SYMBOL_PREFIX = 'nv_';

/** MongoDB duplicate-key error code. */
const DUPLICATE_KEY_ERROR_CODE = 11000;

type MappingFilter = Pick<IShipmentChainId, 'shipmentId' | 'network'>;
type MappingFields = MappingFilter & Pick<IShipmentChainId, 'chainShipmentId' | 'createdAt'>;

function sequenceId(network: ChainNetwork): string {
  return `shipment_chain_id:${network}`;
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === DUPLICATE_KEY_ERROR_CODE
  );
}

function toMapping(doc: MappingFields): ShipmentChainIdMapping {
  return {
    shipmentId: doc.shipmentId.toString(),
    chainShipmentId: doc.chainShipmentId,
    network: doc.network,
    allocatedAt: doc.createdAt.toISOString(),
  };
}

function requireObjectId(shipmentId: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(shipmentId)) {
    throw new AppError(400, 'Invalid shipment id', ErrorCodes.BAD_REQUEST, { shipmentId });
  }
  return new Types.ObjectId(shipmentId);
}

/** Natural key of a mapping row: one u64 per shipment per deployment. */
function mappingFilter(input: ShipmentChainIdLookup): MappingFilter {
  return { shipmentId: requireObjectId(input.shipmentId), network: input.network };
}

/**
 * Atomically reserve the next `u64` for the deployment. A gap (abandoned
 * reservation, lost insert race) is accepted: the contract only requires ids to
 * be unique, not contiguous.
 */
async function reserveChainShipmentId(network: ChainNetwork): Promise<string> {
  const counter = await ShipmentChainIdSequence.findOneAndUpdate(
    { _id: sequenceId(network) },
    { $inc: { sequence: 1 } },
    { new: true, upsert: true }
  ).lean();

  const parsed = counter ? U64StringSchema.safeParse(String(counter.sequence)) : null;
  if (!parsed || !parsed.success) {
    throw new AppError(500, 'Invalid chain id sequence', ErrorCodes.INTERNAL_ERROR);
  }
  return parsed.data;
}

/** Existing mapping for a shipment, or `null`. Never allocates. */
export async function readShipmentChainId(
  input: ShipmentChainIdLookup
): Promise<ShipmentChainIdMapping | null> {
  const filter = mappingFilter(input);
  const doc = await ShipmentChainId.findOne(filter).lean<IShipmentChainId>();
  return doc ? toMapping(doc) : null;
}

/**
 * Read-or-allocate the on-chain `u64` shipment id. Safe to call repeatedly and
 * concurrently: the first caller wins, every other caller reads the winner back.
 */
export async function allocateShipmentChainId(
  input: ShipmentChainIdLookup
): Promise<ShipmentChainIdMapping> {
  const filter = mappingFilter(input);

  // Creation ordering: the mapping is written before the first chain call, and an
  // existing mapping is always reused — never re-allocated, never renumbered.
  const existing = await ShipmentChainId.findOne(filter).lean<IShipmentChainId>();
  if (existing) {
    return toMapping(existing);
  }

  // "Mapping requested for a shipment that does not exist": refuse rather than mint
  // an id that could later be attached to a different shipment. Soft-deleted rows
  // are excluded by the model's pre-hooks, so they count as missing here too.
  const shipment = await Shipment.findOne({ _id: filter.shipmentId }).lean();
  if (!shipment) {
    throw new AppError(404, 'Shipment not found', ErrorCodes.SHIPMENT_NOT_FOUND, {
      shipmentId: input.shipmentId,
    });
  }

  for (let attempt = 0; attempt < MAX_ALLOCATION_ATTEMPTS; attempt += 1) {
    const chainShipmentId = await reserveChainShipmentId(input.network);
    const payload = { shipmentId: filter.shipmentId, chainShipmentId, network: input.network };

    try {
      const created = await ShipmentChainId.create(payload);
      return toMapping(created);
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }

      // A concurrent allocator won the (network, shipmentId) slot — adopt its id.
      const winner = await ShipmentChainId.findOne(filter).lean<IShipmentChainId>();
      if (winner) {
        return toMapping(winner);
      }

      // Otherwise the reserved value already belongs to another shipment: retry.
    }
  }

  throw new AppError(500, 'Chain id allocation failed', ErrorCodes.INTERNAL_ERROR);
}

/**
 * Derived `Symbol` for the `Symbol`-typed chain functions, so anchoring/escrow and
 * `update_status` address the same numeric shipment identity. The value is validated
 * as a u64 first: `nv_0x1f` is a legal Symbol but a nonsense shipment id.
 */
export function chainShipmentIdSymbol(chainShipmentId: string): string {
  const parsed = U64StringSchema.safeParse(chainShipmentId);
  if (!parsed.success) {
    throw new AppError(500, 'Invalid chain shipment id', ErrorCodes.INTERNAL_ERROR);
  }
  return `${CHAIN_SHIPMENT_ID_SYMBOL_PREFIX}${parsed.data}`;
}

/** Injectable binding of the mapping repository. */
export const shipmentChainIdRepository: ShipmentChainIdRepository = {
  read: readShipmentChainId,
  allocate: allocateShipmentChainId,
};
