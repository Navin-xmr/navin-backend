/**
 * Schema-inspection tests for the P11-10 on-chain shipment id mapping models
 * (`ShipmentChainId`, `ShipmentChainIdSequence`).
 *
 * These assert the constraints that cannot be checked behaviourally without a live
 * MongoDB: the two unique indexes that arbitrate concurrent allocation / u64
 * collisions, and the counter's addressability by `_id`. No mocks — the real models
 * are imported and their schema definitions inspected.
 *
 * Behavioural allocate / read / conflict coverage lives in
 * `tests/chain.shipment-id-mapping.test.ts`.
 * Design: `docs/adr-objectid-chain-shipment-id.md`.
 */

import { describe, it, expect } from '@jest/globals';
import { ShipmentChainId } from '../src/modules/shipments/shipmentChainId.model.js';
import { ShipmentChainIdSequence } from '../src/modules/shipments/shipmentChainIdSequence.model.js';

type IndexFields = Record<string, number>;

type IndexTuple = [Record<string, unknown>, Record<string, unknown> | undefined];

/** Structural view of a compiled model, cast through `unknown` to keep the suite type-safe. */
interface ModelView {
  modelName: string;
  schema: {
    indexes: () => unknown;
    paths: Record<string, unknown>;
  };
}

function schemaIndexes(model: unknown): IndexTuple[] {
  return (model as ModelView).schema.indexes() as IndexTuple[];
}

function schemaPaths(model: unknown): Record<string, unknown> {
  return (model as ModelView).schema.paths;
}

/** Exact-match lookup so `{ network: 1, shipmentId: 1 }` cannot be satisfied by a prefix. */
function matches(candidate: Record<string, unknown>, fields: IndexFields): boolean {
  const expected = Object.entries(fields);
  if (Object.keys(candidate).length !== expected.length) return false;
  return expected.every(([field, direction]) => candidate[field] === direction);
}

function findIndex(indexes: IndexTuple[], fields: IndexFields): IndexTuple | undefined {
  return indexes.find(([candidate]) => matches(candidate, fields));
}

function uniqueFieldSpecs(model: unknown): Record<string, unknown>[] {
  return schemaIndexes(model)
    .filter(([, options]) => options?.unique === true)
    .map(([fields]) => fields);
}

describe('ShipmentChainId — mapping uniqueness (P11-10)', () => {
  it('registers the mapping collection under its own model name', () => {
    expect((ShipmentChainId as unknown as ModelView).modelName).toBe('ShipmentChainId');
  });

  it('declares a unique { network: 1, shipmentId: 1 } index', () => {
    const match = findIndex(schemaIndexes(ShipmentChainId), { network: 1, shipmentId: 1 });

    expect(match).toBeDefined();
    expect(match?.[1]).toMatchObject({ unique: true });
  });

  it('declares a unique { network: 1, chainShipmentId: 1 } index', () => {
    const match = findIndex(schemaIndexes(ShipmentChainId), { network: 1, chainShipmentId: 1 });

    expect(match).toBeDefined();
    expect(match?.[1]).toMatchObject({ unique: true });
  });

  it('declares exactly those two unique indexes, so no accidental key constraint exists', () => {
    const fieldSpecs = uniqueFieldSpecs(ShipmentChainId);

    expect(fieldSpecs).toHaveLength(2);
    expect(fieldSpecs).toEqual(
      expect.arrayContaining([
        { network: 1, shipmentId: 1 },
        { network: 1, chainShipmentId: 1 },
      ])
    );
  });

  it('is soft-deletable by convention, matching the other domain models', () => {
    expect(schemaPaths(ShipmentChainId).deletedAt).toBeDefined();
  });
});

describe('ShipmentChainIdSequence — monotonic counter (P11-10)', () => {
  it('registers the counter under its own model name', () => {
    expect((ShipmentChainIdSequence as unknown as ModelView).modelName).toBe(
      'ShipmentChainIdSequence'
    );
  });

  it('declares no secondary index, so the counter is only addressed by `_id`', () => {
    expect(schemaIndexes(ShipmentChainIdSequence)).toEqual([]);
  });

  it('has no `deletedAt` path — the counter is infrastructure state and never recycled', () => {
    expect(schemaPaths(ShipmentChainIdSequence).deletedAt).toBeUndefined();
  });
});
