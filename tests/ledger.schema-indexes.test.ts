/**
 * Schema-inspection tests for LedgerBlockSchema.
 * Validates that the { dataHash: 1 } sparse index is declared (issue #660).
 *
 * No mocks — imports the real model to inspect its schema definition.
 */

import { describe, it, expect } from '@jest/globals';
import { Types } from 'mongoose';
import { LedgerBlock } from '../src/modules/ledger/ledger.model.js';

describe('LedgerBlockSchema — dataHash index (issue #660)', () => {
  it('defines a { milestoneEvent: 1, createdAt: -1 } index and no eventType index', () => {
    const fieldSpecs = LedgerBlock.schema
      .indexes()
      .map(([fields]: [Record<string, unknown>]) => fields);

    expect(fieldSpecs).toEqual(
      expect.arrayContaining([{ milestoneEvent: 1, createdAt: -1 }]),
    );
    expect(fieldSpecs).not.toEqual(
      expect.arrayContaining([{ eventType: 1, createdAt: -1 }]),
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
});

describe('LedgerBlockSchema — v2 event fields (issue #994)', () => {
  it('declares v2 fields with legacy-compatible defaults', () => {
    const paths = LedgerBlock.schema.paths;
    expect(paths.schemaVersion.options.default).toBe(1);
    expect(paths.eventCounter.options.default).toBe(0);
    expect(paths.idempotencyKey).toBeDefined();
    expect(paths.contractId).toBeDefined();
    expect(paths.eventTopic).toBeDefined();

    const doc = new LedgerBlock({
      shipmentId: new Types.ObjectId(),
      milestoneEvent: 'CREATED',
    });
    expect(doc.schemaVersion).toBe(1);
    expect(doc.eventCounter).toBe(0);
  });

  it('deduplicates v2 events with a unique partial idempotencyKey index', () => {
    const match = LedgerBlock.schema
      .indexes()
      .find(([fields]: [Record<string, unknown>]) => fields.idempotencyKey === 1);
    expect(match).toBeDefined();
    const [, options] = match as [unknown, Record<string, unknown>];
    expect(options).toMatchObject({
      unique: true,
      partialFilterExpression: { idempotencyKey: { $type: 'string' } },
    });
  });
});
