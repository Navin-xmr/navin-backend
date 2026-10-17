/**
 * Schema-inspection tests for LedgerBlockSchema.
 * Validates that the { dataHash: 1 } sparse index is declared (issue #660).
 *
 * No mocks — imports the real model to inspect its schema definition.
 */

import { describe, it, expect } from '@jest/globals';
import { LedgerBlock } from '../src/modules/ledger/ledger.model.js';

describe('LedgerBlockSchema — dataHash index (issue #660)', () => {
  it('defines a { dataHash: 1 } index on the schema', () => {
    const fieldSpecs = LedgerBlock.schema
      .indexes()
      .map(([fields]: [Record<string, unknown>]) => fields);

    expect(fieldSpecs).toEqual(
      expect.arrayContaining([{ dataHash: 1 }]),
    );
  });

  it('marks the { dataHash: 1 } index as sparse', () => {
    const indexes = LedgerBlock.schema.indexes();
    const match = indexes.find(
      ([fields]: [Record<string, unknown>]) => fields.dataHash === 1,
    );

    expect(match).toBeDefined();
    const [, options] = match as [unknown, Record<string, unknown>];
    expect(options).toMatchObject({ sparse: true });
  });

  it('defines { milestoneEvent: 1, createdAt: -1 } and omits stale { eventType: 1, createdAt: -1 }', () => {
    const fieldSpecs = LedgerBlock.schema
      .indexes()
      .map(([fields]: [Record<string, unknown>]) => fields);

    expect(fieldSpecs).toEqual(
      expect.arrayContaining([{ milestoneEvent: 1, createdAt: -1 }]),
    );
    expect(fieldSpecs).not.toEqual(
      expect.arrayContaining([{ eventType: 1, createdAt: -1 }]),
    );
    expect(fieldSpecs.some(fields => 'eventType' in fields)).toBe(false);
  });
});
