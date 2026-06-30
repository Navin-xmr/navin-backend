import type { Schema } from 'mongoose';

/**
 * Mongoose plugin that converts dates to ISO 8601 UTC strings in JSON output.
 *
 * When a document (or lean-object result) is converted to JSON – e.g. by
 * `res.json()` calling `JSON.stringify()` – this plugin's `toJSON` transform
 * is invoked, recursively converting every `Date` value to its UTC ISO string
 * representation (`2026-04-25T11:00:00.000Z`).
 *
 * Usage:
 *   ShipmentSchema.plugin(isoDatePlugin);
 *   AnomalySchema.plugin(isoDatePlugin);
 *   TelemetrySchema.plugin(isoDatePlugin);
 */

function serializeDatesInObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    result[key] = serializeValue(value);
  }

  return result;
}

function serializeValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }

  if (value !== null && typeof value === 'object') {
    return serializeDatesInObject(value as Record<string, unknown>);
  }

  return value;
}

export function isoDatePlugin(schema: Schema): void {
  const existingToJSON = schema.get('toJSON') as
    | { transform?: (...args: unknown[]) => unknown; virtuals?: boolean; versionKey?: boolean }
    | undefined;

  schema.set('toJSON', {
    ...existingToJSON,
    transform: (_doc: unknown, ret: Record<string, unknown>) => {
      // Apply any pre-existing transform first.
      let result = ret;
      if (typeof existingToJSON?.transform === 'function') {
        result = (existingToJSON.transform(_doc, ret) as Record<string, unknown>) ?? ret;
      }
      // Then recursively convert all Dates to ISO strings.
      return serializeDatesInObject(result);
    },
  });
}
