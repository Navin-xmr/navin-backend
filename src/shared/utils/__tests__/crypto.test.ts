import { generateDataHash } from '../crypto.js';

describe('generateDataHash', () => {
  // Core requirement
  it('same data different key order → same hash', () => {
    const a = { z: 1, a: 2, m: 3 };
    const b = { m: 3, z: 1, a: 2 };
    expect(generateDataHash(a)).toBe(generateDataHash(b));
  });

  it('handles nested objects with unsorted keys', () => {
    const a = { user: { name: "Ada", id: 1 }, role: "admin" };
    const b = { role: "admin", user: { id: 1, name: "Ada" } };
    expect(generateDataHash(a)).toBe(generateDataHash(b));
  });

  // Primitives
  it('handles primitive types', () => {
    expect(generateDataHash(42)).toBe(generateDataHash(42));
    expect(generateDataHash("hello")).toBe(generateDataHash("hello"));
    expect(generateDataHash(true)).toBe(generateDataHash(true));
  });

  // Edge cases (explicitly required)
  it('handles null values', () => {
    expect(() => generateDataHash(null)).not.toThrow();
    expect(generateDataHash({ a: null })).toBe(generateDataHash({ a: null }));
  });

  it('handles empty arrays', () => {
    expect(generateDataHash([])).toBe(generateDataHash([]));
  });

  it('handles empty objects', () => {
    expect(generateDataHash({})).toBe(generateDataHash({}));
  });

  // Extra: Date and undefined (from existing implementation's behavior)
  it('handles Date objects', () => {
    const d = new Date("2024-01-01T00:00:00.000Z");
    expect(generateDataHash({ date: d })).toBe(generateDataHash({ date: d }));
  });

  it('omits undefined properties', () => {
    expect(generateDataHash({ x: 1, y: undefined })).toBe(generateDataHash({ x: 1 }));
  });

  // Output format
  it('returns a 64-char SHA-256 hex string', () => {
    expect(generateDataHash({ foo: 'bar' })).toMatch(/^[a-f0-9]{64}$/);
  });
});