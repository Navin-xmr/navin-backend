/**
 * P11-10 — unit tests for the ObjectId ↔ on-chain u64 shipment id mapping.
 *
 * Covers the allocate / read / conflict paths specified in
 * docs/adr-objectid-chain-shipment-id.md. Data-access models are mocked
 * (resetModules → unstable_mockModule → dynamic import), so no database is needed.
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Types } from 'mongoose';
import { ErrorCodes } from '../src/shared/http/errors.js';

const SHIPMENT_ID = new Types.ObjectId().toString();
const ALLOCATED_AT = new Date('2026-01-02T03:04:05.000Z');
const TESTNET_LOOKUP = { shipmentId: SHIPMENT_ID, network: 'testnet' } as const;

type MappingFilter = { shipmentId: Types.ObjectId; network: string };

type MappingDoc = {
  shipmentId: Types.ObjectId;
  chainShipmentId: string;
  network: string;
  createdAt: Date;
};

function mappingDoc(chainShipmentId: string): MappingDoc {
  return {
    shipmentId: new Types.ObjectId(SHIPMENT_ID),
    chainShipmentId,
    network: 'testnet',
    createdAt: ALLOCATED_AT,
  };
}

/** Stub for `Model.findOne(...).lean()`. */
function leanOf<T>(value: T) {
  return { lean: jest.fn(async () => value) };
}

/** MongoDB duplicate-key error, as thrown by the unique mapping indexes. */
function duplicateKeyError(): Error {
  return Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
}

type RepoMocks = {
  mappingFindOne?: jest.Mock;
  mappingCreate?: jest.Mock;
  shipmentFindOne?: jest.Mock;
  sequenceFindOneAndUpdate?: jest.Mock;
};

async function loadRepo(mocks: RepoMocks = {}) {
  const mappingFindOne = mocks.mappingFindOne ?? jest.fn();
  const mappingCreate = mocks.mappingCreate ?? jest.fn();
  const shipmentFindOne = mocks.shipmentFindOne ?? jest.fn();
  const sequenceFindOneAndUpdate = mocks.sequenceFindOneAndUpdate ?? jest.fn();

  await jest.unstable_mockModule('../src/modules/shipments/shipmentChainId.model.js', () => ({
    ShipmentChainId: { findOne: mappingFindOne, create: mappingCreate },
  }));
  await jest.unstable_mockModule(
    '../src/modules/shipments/shipmentChainIdSequence.model.js',
    () => ({ ShipmentChainIdSequence: { findOneAndUpdate: sequenceFindOneAndUpdate } })
  );
  await jest.unstable_mockModule('../src/modules/shipments/shipments.model.js', () => ({
    Shipment: { findOne: shipmentFindOne },
  }));

  const repo = await import('../src/modules/shipments/shipmentChainId.repo.js');
  return { repo, mappingFindOne, mappingCreate, shipmentFindOne, sequenceFindOneAndUpdate };
}

function existingShipment() {
  return { _id: new Types.ObjectId(SHIPMENT_ID) };
}

describe('shipmentChainId.repo — read', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('returns the persisted mapping and never allocates', async () => {
    const mappingFindOne = jest.fn(() => leanOf(mappingDoc('7')));
    const { repo, mappingCreate, sequenceFindOneAndUpdate } = await loadRepo({ mappingFindOne });

    const mapping = await repo.readShipmentChainId(TESTNET_LOOKUP);

    expect(mapping).toEqual({
      shipmentId: SHIPMENT_ID,
      chainShipmentId: '7',
      network: 'testnet',
      allocatedAt: ALLOCATED_AT.toISOString(),
    });

    const filter = mappingFindOne.mock.calls[0]![0] as MappingFilter;
    expect(filter.shipmentId.toString()).toBe(SHIPMENT_ID);
    expect(filter.network).toBe('testnet');
    expect(mappingCreate).not.toHaveBeenCalled();
    expect(sequenceFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('returns null when the shipment has no on-chain id yet', async () => {
    const { repo, mappingCreate } = await loadRepo({ mappingFindOne: jest.fn(() => leanOf(null)) });

    expect(await repo.readShipmentChainId(TESTNET_LOOKUP)).toBeNull();
    expect(mappingCreate).not.toHaveBeenCalled();
  });

  it('rejects a non-ObjectId shipment id before touching any store', async () => {
    const mappingFindOne = jest.fn();
    const { repo } = await loadRepo({ mappingFindOne });

    // 'ship-1' is deliberately not a 24-char ObjectId: the guard must reject it.
    const read = repo.readShipmentChainId({ shipmentId: 'ship-1', network: 'testnet' });

    await expect(read).rejects.toMatchObject({ statusCode: 400, code: ErrorCodes.BAD_REQUEST });
    expect(mappingFindOne).not.toHaveBeenCalled();
  });
});

describe('shipmentChainId.repo — allocate', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('mints the next u64 before the first chain write', async () => {
    const mappingCreate = jest.fn(async (payload: Record<string, unknown>) => ({
      ...payload,
      createdAt: ALLOCATED_AT,
    }));
    const { repo, shipmentFindOne, sequenceFindOneAndUpdate } = await loadRepo({
      mappingFindOne: jest.fn(() => leanOf(null)),
      mappingCreate,
      shipmentFindOne: jest.fn(() => leanOf(existingShipment())),
      sequenceFindOneAndUpdate: jest.fn(() => leanOf({ sequence: 1 })),
    });

    const mapping = await repo.allocateShipmentChainId(TESTNET_LOOKUP);

    expect(sequenceFindOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'shipment_chain_id:testnet' },
      { $inc: { sequence: 1 } },
      { new: true, upsert: true }
    );
    expect(shipmentFindOne).toHaveBeenCalledTimes(1);

    const payload = mappingCreate.mock.calls[0]![0] as MappingFilter & { chainShipmentId: string };
    expect(payload.shipmentId.toString()).toBe(SHIPMENT_ID);
    expect(payload.chainShipmentId).toBe('1');
    expect(payload.network).toBe('testnet');

    expect(mapping).toEqual({
      shipmentId: SHIPMENT_ID,
      chainShipmentId: '1',
      network: 'testnet',
      allocatedAt: ALLOCATED_AT.toISOString(),
    });
  });

  it('is idempotent: an existing mapping is reused and nothing is re-allocated', async () => {
    const mappingFindOne = jest.fn(() => leanOf(mappingDoc('5')));
    const { repo, mappingCreate, shipmentFindOne, sequenceFindOneAndUpdate } = await loadRepo({
      mappingFindOne,
    });

    const mapping = await repo.allocateShipmentChainId(TESTNET_LOOKUP);

    expect(mapping.chainShipmentId).toBe('5');
    expect(mappingFindOne).toHaveBeenCalledTimes(1);
    expect(shipmentFindOne).not.toHaveBeenCalled();
    expect(sequenceFindOneAndUpdate).not.toHaveBeenCalled();
    expect(mappingCreate).not.toHaveBeenCalled();
  });

  it('rejects 404 when the shipment row does not exist', async () => {
    const { repo, mappingCreate, sequenceFindOneAndUpdate } = await loadRepo({
      mappingFindOne: jest.fn(() => leanOf(null)),
      shipmentFindOne: jest.fn(() => leanOf(null)),
    });

    const allocation = repo.allocateShipmentChainId(TESTNET_LOOKUP);

    await expect(allocation).rejects.toMatchObject({
      statusCode: 404,
      code: ErrorCodes.SHIPMENT_NOT_FOUND,
    });
    expect(sequenceFindOneAndUpdate).not.toHaveBeenCalled();
    expect(mappingCreate).not.toHaveBeenCalled();
  });

  it('adopts the winner id when a concurrent allocator wins the race', async () => {
    let reads = 0;
    const mappingFindOne = jest.fn(() => leanOf(reads++ === 0 ? null : mappingDoc('2')));
    const mappingCreate = jest.fn(async () => {
      throw duplicateKeyError();
    });
    const { repo, sequenceFindOneAndUpdate } = await loadRepo({
      mappingFindOne,
      mappingCreate,
      shipmentFindOne: jest.fn(() => leanOf(existingShipment())),
      sequenceFindOneAndUpdate: jest.fn(() => leanOf({ sequence: 2 })),
    });

    const mapping = await repo.allocateShipmentChainId(TESTNET_LOOKUP);

    expect(mapping.chainShipmentId).toBe('2');
    expect(mappingCreate).toHaveBeenCalledTimes(1);
    // The loser's reserved value is abandoned — a documented gap, never re-used.
    expect(sequenceFindOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('retries the next sequence value when the u64 is already owned', async () => {
    let reserved = 0;
    let created = 0;
    const mappingCreate = jest.fn(async (payload: Record<string, unknown>) => {
      created += 1;
      if (created < 3) {
        throw duplicateKeyError();
      }
      return { ...payload, createdAt: ALLOCATED_AT };
    });
    const { repo, sequenceFindOneAndUpdate } = await loadRepo({
      mappingFindOne: jest.fn(() => leanOf(null)),
      mappingCreate,
      shipmentFindOne: jest.fn(() => leanOf(existingShipment())),
      sequenceFindOneAndUpdate: jest.fn(() => leanOf({ sequence: (reserved += 1) })),
    });

    const mapping = await repo.allocateShipmentChainId(TESTNET_LOOKUP);

    expect(mapping.chainShipmentId).toBe('3');
    expect(mappingCreate).toHaveBeenCalledTimes(3);
    expect(sequenceFindOneAndUpdate).toHaveBeenCalledTimes(3);
  });

  it('rejects 500 after the bounded retries are exhausted', async () => {
    const mappingCreate = jest.fn(async () => {
      throw duplicateKeyError();
    });
    const { repo } = await loadRepo({
      mappingFindOne: jest.fn(() => leanOf(null)),
      mappingCreate,
      shipmentFindOne: jest.fn(() => leanOf(existingShipment())),
      sequenceFindOneAndUpdate: jest.fn(() => leanOf({ sequence: 1 })),
    });

    const allocation = repo.allocateShipmentChainId(TESTNET_LOOKUP);

    await expect(allocation).rejects.toMatchObject({
      statusCode: 500,
      code: ErrorCodes.INTERNAL_ERROR,
    });
    expect(mappingCreate).toHaveBeenCalledTimes(repo.MAX_ALLOCATION_ATTEMPTS);
  });

  it('propagates non-duplicate database errors untouched', async () => {
    const mappingCreate = jest.fn(async () => {
      throw new Error('database exploded');
    });
    const { repo } = await loadRepo({
      mappingFindOne: jest.fn(() => leanOf(null)),
      mappingCreate,
      shipmentFindOne: jest.fn(() => leanOf(existingShipment())),
      sequenceFindOneAndUpdate: jest.fn(() => leanOf({ sequence: 1 })),
    });

    await expect(repo.allocateShipmentChainId(TESTNET_LOOKUP)).rejects.toThrow('database exploded');
  });

  it('exposes the repository interface binding', async () => {
    const { repo } = await loadRepo();

    expect(repo.shipmentChainIdRepository.read).toBe(repo.readShipmentChainId);
    expect(repo.shipmentChainIdRepository.allocate).toBe(repo.allocateShipmentChainId);
  });
});

describe('shipmentChainId.repo — Symbol bridge', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('derives the anchor/escrow Symbol from the same u64 identity', async () => {
    const { repo } = await loadRepo();
    const maxU64 = '18446744073709551615';

    expect(repo.chainShipmentIdSymbol('42')).toBe('nv_42');
    expect(repo.chainShipmentIdSymbol(maxU64)).toMatch(/^[A-Za-z0-9_]{1,32}$/);
    expect(repo.chainShipmentIdSymbol(maxU64)).toHaveLength(23);
  });

  it('refuses values that are not canonical u64 decimal strings', async () => {
    const { repo } = await loadRepo();

    // A legal Soroban Symbol, but a nonsense shipment id.
    expect(() => repo.chainShipmentIdSymbol('0x1f')).toThrow();
    expect(() => repo.chainShipmentIdSymbol('184467440737095516150')).toThrow();
    expect(() => repo.chainShipmentIdSymbol('07')).toThrow();
  });
});
