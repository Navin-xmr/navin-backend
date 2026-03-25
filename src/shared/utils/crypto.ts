import { createHash } from 'node:crypto';

function normalizeForDeterministicJson(value: unknown): unknown {
  if (value === null) return null;

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(normalizeForDeterministicJson);
  }

  const t = typeof value;
  if (t !== 'object') return value; // primitives

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const normalized: Record<string, unknown> = {};

  for (const key of keys) {
    const v = record[key];
    // Match JSON.stringify's behavior by omitting `undefined` properties.
    if (v === undefined) continue;
    normalized[key] = normalizeForDeterministicJson(v);
  }

  return normalized;
}

export function generateDataHash(payload: unknown): string {
  const normalized = normalizeForDeterministicJson(payload);
  const serialized = JSON.stringify(normalized);
  // Requirement: strip all whitespace from the serialized representation.
  const compact = serialized.replace(/\s+/g, '');
  return createHash('sha256').update(compact).digest('hex');
}

