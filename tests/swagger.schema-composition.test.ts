import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import YAML from 'yamljs';

/**
 * Regression guard for the Redocly schema-composition rules (issue #635).
 *
 * `npm run lint:openapi` reports these as warnings rather than errors, so they
 * can silently regress. These assertions pin the two shapes that were fixed:
 *
 * 1. `spec-ref-siblings` - a `nullable` (or any other) sibling next to `$ref`
 *    is ignored per JSON Reference semantics, so the property must wrap the
 *    reference in `allOf` instead.
 * 2. `no-illogical-composition-keywords` - the two shipment ETA response
 *    branches must be mutually exclusive so `oneOf` is unambiguous.
 */

type JsonNode = Record<string, unknown>;

const swaggerPath = fileURLToPath(new URL('../docs/swagger.yaml', import.meta.url));
// `YAML.load` matches how src/app.ts serves the document at /api-docs and
// returns the first document of the multi-document file.
const document = YAML.load(swaggerPath) as JsonNode;

/** Keys that are siblings of `$ref` and therefore silently dropped by tooling. */
const REF_BROKEN_SIBLINGS = ['nullable', 'type', 'format', 'default', 'example', 'enum'];

function isObject(value: unknown): value is JsonNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Walk the document and collect every `$ref` that is followed by a sibling key. */
function findRefSiblings(node: unknown, pointer = '#'): Array<{ pointer: string; key: string }> {
  if (Array.isArray(node)) {
    return node.flatMap((child, index) => findRefSiblings(child, `${pointer}/${index}`));
  }
  if (!isObject(node)) return [];

  const siblings = Object.keys(node).filter(
    (key) => key !== '$ref' && REF_BROKEN_SIBLINGS.includes(key)
  );

  const own = typeof node.$ref === 'string'
    ? siblings.map((key) => ({ pointer: `${pointer}/${key}`, key }))
    : [];

  return [...own, ...Object.entries(node).flatMap(([key, child]) => findRefSiblings(child, `${pointer}/${key}`))];
}

function getIn(root: JsonNode, path: string[]): unknown {
  return path.reduce<unknown>((acc, key) => (isObject(acc) ? acc[key] : undefined), root);
}

describe('docs/swagger.yaml schema composition', () => {
  it('parses as a valid OpenAPI 3.0 document', () => {
    expect(document.openapi).toMatch(/^3\.0\.\d+$/);
    expect(document.components).toBeDefined();
  });

  it('never places a schema key next to a $ref (Redocly spec-ref-siblings)', () => {
    expect(findRefSiblings(document)).toEqual([]);
  });

  describe('Settlement.escrowRelease', () => {
    const escrowRelease = getIn(document, [
      'components',
      'schemas',
      'Settlement',
      'properties',
      'escrowRelease',
    ]) as JsonNode;

    it('keeps the $ref reachable through allOf', () => {
      expect(escrowRelease.$ref).toBeUndefined();
      expect(escrowRelease.allOf).toEqual([{ $ref: '#/components/schemas/EscrowRelease' }]);
    });

    it('expresses nullability alongside the declared type, not next to the $ref', () => {
      expect(escrowRelease.nullable).toBe(true);
      expect(escrowRelease.type).toBe('object');
    });
  });

  describe('GET /api/shipments/{id}/eta response', () => {
    const data = getIn(document, [
      'paths',
      '/api/shipments/{id}/eta',
      'get',
      'responses',
      '200',
      'content',
      'application/json',
      'schema',
      'properties',
      'data',
    ]) as JsonNode;

    const branches = data.oneOf as JsonNode[];

    it('models the ShipmentEtaPayload union as a oneOf', () => {
      expect(branches).toHaveLength(2);
    });

    it.each(branches.map((branch, index) => [index, branch] as const))(
      'closes branch %i so unknown/foreign properties are rejected',
      (_index, branch) => {
        expect(branch.type).toBe('object');
        expect(branch.additionalProperties).toBe(false);
        expect(Array.isArray(branch.required)).toBe(true);
      }
    );

    it('makes the two branches mutually exclusive', () => {
      const [inTransit, notInTransit] = branches;
      const requiredInTransit = new Set<string>(inTransit.required as string[]);
      const requiredNotInTransit = new Set<string>(notInTransit.required as string[]);
      const propertiesInTransit = Object.keys(inTransit.properties as JsonNode);
      const propertiesNotInTransit = Object.keys(notInTransit.properties as JsonNode);

      // Both branches require `estimatedArrival`; the exclusivity comes from
      // every *other* required property being unknown to the opposite branch.
      // Without that, a single payload could satisfy both branches and `oneOf`
      // would be ambiguous.
      const sharedRequired = [...requiredInTransit].filter((key) => requiredNotInTransit.has(key));
      expect(sharedRequired).toEqual(['estimatedArrival']);

      for (const key of requiredInTransit) {
        if (key === 'estimatedArrival') continue;
        expect(propertiesNotInTransit).not.toContain(key);
      }
      for (const key of requiredNotInTransit) {
        if (key === 'estimatedArrival') continue;
        expect(propertiesInTransit).not.toContain(key);
      }

      // And the shared key itself is constrained differently in each branch.
      const sharedInTransit = (inTransit.properties as JsonNode).estimatedArrival as JsonNode;
      const sharedNotInTransit = (notInTransit.properties as JsonNode).estimatedArrival as JsonNode;
      expect(sharedInTransit.nullable).toBeUndefined();
      expect(sharedInTransit.format).toBe('date-time');
      expect(sharedNotInTransit.nullable).toBe(true);
    });
  });
});
