import { describe, expect, it } from '@jest/globals';

import { generateDataHash } from '../src/shared/utils/crypto.js';

describe('generateDataHash (deterministic SHA-256)', () => {
  it('returns the same hash for identical data with different key order', () => {
    const a = { b: 1, a: { d: 2, c: 3 } };
    const b = { a: { c: 3, d: 2 }, b: 1 };

    expect(generateDataHash(a)).toBe(generateDataHash(b));
  });

  it('preserves array ordering (different array order => different hash)', () => {
    const a = { arr: [1, 2, 3] };
    const b = { arr: [3, 2, 1] };

    expect(generateDataHash(a)).not.toBe(generateDataHash(b));
  });

  it('handles null values and empty arrays consistently', () => {
    const a = { x: null, list: [] };
    const b = { list: [], x: null };

    expect(generateDataHash(a)).toBe(generateDataHash(b));
  });

  it('strips all whitespace from the serialized representation', () => {
    const a = { msg: 'hello world' };
    const b = { msg: 'helloworld' };

    expect(generateDataHash(a)).toBe(generateDataHash(b));
  });
});

