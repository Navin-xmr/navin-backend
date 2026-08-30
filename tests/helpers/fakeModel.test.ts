import { describe, expect, it } from '@jest/globals';
import { fakeQuery } from './fakeModel.js';

describe('fakeQuery', () => {
  it('resolves the fixture when lean is called after query modifiers', async () => {
    const fixture = [{ id: 'shipment-1' }];

    await expect(fakeQuery(fixture).sort({ createdAt: -1 }).limit(1).lean()).resolves.toEqual(
      fixture
    );
  });

  it('resolves the same fixture when lean is called first', async () => {
    const fixture = [{ id: 'shipment-1' }];

    await expect(fakeQuery(fixture).lean()).resolves.toEqual(fixture);
  });
});
