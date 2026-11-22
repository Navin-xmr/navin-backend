import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { ErrorCodes } from '../src/shared/http/errors.js';
import {
  CHAIN_CONTRACT_ERRORS,
  CHAIN_ERROR_MAP,
  CHAIN_EVENT_NAMES,
  CHAIN_FUNCTION_AUTH,
  CHAIN_FUNCTIONS,
  CHAIN_SPEC_VERSION,
  ChainContractErrorSchema,
  ChainEventSchema,
  ChainEventVerificationSchema,
  ChainFunctionArgsSchemas,
  chainErrorToAppError,
  parseChainEvent,
} from '../src/shared/types/chain.js';

type Json = Record<string, unknown>;

const loadFixture = <T>(name: string): T =>
  JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/chain', name), 'utf8')) as T;

const functions = loadFixture<{
  spec_version: string;
  args: Record<(typeof CHAIN_FUNCTIONS)[number], Json>;
  tx_result: Json;
}>('functions.json');
const events = loadFixture<{ spec_version: string; events: Record<string, Json> }>('events.json');
const errors = loadFixture<{ spec_version: string; errors: Json[] }>('errors.json');

const clone = <T>(v: T): T => structuredClone(v);
const without = (obj: Json, key: string): Json => {
  const copy = clone(obj);
  delete copy[key];
  return copy;
};

/**
 * #1057 — table-driven round-trip + mutation coverage for every v2 schema.
 * Each function/event/error schema has: a valid fixture that parses unchanged,
 * a missing-field case, a wrong-type case, an extra-field case and (where an
 * enum/format applies) a bad-enum case. `reports/chain-schema-coverage.md`
 * records the resulting coverage matrix for src/shared/types/chain.ts.
 */
describe('v2 spec pin', () => {
  it.each([
    ['functions.json', functions.spec_version],
    ['events.json', events.spec_version],
    ['errors.json', errors.spec_version],
  ])('%s matches CHAIN_SPEC_VERSION', (_file, version) => {
    expect(version).toBe(CHAIN_SPEC_VERSION);
    expect(CHAIN_SPEC_VERSION).toBe('2.1.0');
  });
});

describe('v2 function schemas — round trip and mutations', () => {
  describe.each(CHAIN_FUNCTIONS.map(name => [name] as const))('%s', name => {
    const fixture = functions.args[name];
    const schema = ChainFunctionArgsSchemas[name];

    it('parses the valid fixture unchanged and survives JSON serialisation', () => {
      const parsed = schema.parse(fixture);
      expect(parsed).toEqual(fixture);
      expect(schema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(fixture);
    });

    it.each(Object.keys(fixture))('rejects when required field "%s" is removed', key => {
      expect(schema.safeParse(without(fixture, key)).success).toBe(false);
    });

    it.each(Object.keys(fixture))('rejects when field "%s" has the wrong type', key => {
      // {} fails every spec primitive (string/number/array), unlike a bare
      // number literal which happens to be the correct type for `deadline`.
      expect(schema.safeParse({ ...fixture, [key]: {} }).success).toBe(false);
    });

    it('rejects an extra field (strict schema / spec drift)', () => {
      expect(schema.safeParse({ ...fixture, unexpected_field: 'x' }).success).toBe(false);
    });
  });

  it.each([
    ['anchor', 'shipment_id', 'has-dash'],
    ['anchor', 'actor', 'G_SHORT'],
    ['init_escrow', 'amount', '0'],
    ['init_escrow', 'token', 'G_NOT_A_CONTRACT'],
    ['release_escrow', 'caller', 'not-an-address'],
    ['release_escrow', 'shipment_id', 'x'.repeat(33)],
  ] as const)('%s rejects bad enum/format for %s', (fn, key, value) => {
    expect(
      ChainFunctionArgsSchemas[fn].safeParse({ ...functions.args[fn], [key]: value }).success
    ).toBe(false);
  });

  it('pins v2 escrow auth and per-shipment arguments', () => {
    expect(CHAIN_FUNCTION_AUTH.release_escrow).toBe('caller');
    expect(Object.keys(functions.args.release_escrow).sort()).toEqual(['caller', 'shipment_id']);
    expect(
      ChainFunctionArgsSchemas.release_escrow.safeParse({
        ...functions.args.release_escrow,
        payment_id: 'legacy',
        proof_hash: 'a'.repeat(64),
      }).success
    ).toBe(false);
  });
});

describe('v2 event schemas — round trip and mutations', () => {
  describe.each(Object.values(CHAIN_EVENT_NAMES).map(name => [name] as const))('%s', name => {
    const fixture = events.events[name]!;

    it('parses the valid fixture unchanged (parseChainEvent round trip)', () => {
      expect(ChainEventSchema.parse(fixture)).toEqual(fixture);
      expect(parseChainEvent(clone(fixture))).toEqual(fixture);
    });

    it.each(Object.keys(fixture))('rejects a missing "%s"', key => {
      expect(ChainEventSchema.safeParse(without(fixture, key)).success).toBe(false);
    });

    it('rejects extra fields and malformed data tuples', () => {
      expect(ChainEventSchema.safeParse({ ...fixture, extra: true }).success).toBe(false);
      expect(ChainEventSchema.safeParse({ ...fixture, data: [] }).success).toBe(false);
      expect(ChainEventSchema.safeParse({ ...fixture, ledger: -1 }).success).toBe(false);
    });
  });
});

describe('v2 error schemas — round trip and mutations', () => {
  it('every contract error has a fixture, mapping and registered backend code', () => {
    expect(errors.errors.map(e => e.code).sort()).toEqual(
      Object.values(CHAIN_CONTRACT_ERRORS).sort()
    );
    expect(Object.keys(CHAIN_ERROR_MAP).sort()).toEqual(Object.keys(CHAIN_CONTRACT_ERRORS).sort());
    for (const fixture of errors.errors) {
      expect(ChainContractErrorSchema.parse(fixture)).toEqual(fixture);
      const appError = chainErrorToAppError(fixture.code as number);
      expect(appError.code).toMatch(/^ERR_CHAIN_/);
    }
  });

  it.each([
    { code: 99, function: 'anchor' },
    { code: '1', function: 'anchor' },
    { code: 1, function: 'transfer' },
    { code: 1, function: 'anchor', extra: true },
  ])('rejects mutated error %p', mutated => {
    expect(ChainContractErrorSchema.safeParse(mutated).success).toBe(false);
  });

  it('surfaces InvalidStatus and Unauthorized with coded AppErrors', () => {
    expect(chainErrorToAppError(CHAIN_CONTRACT_ERRORS.InvalidStatus)).toMatchObject({
      code: ErrorCodes.CHAIN_INVALID_STATUS,
      statusCode: 409,
    });
    expect(chainErrorToAppError(CHAIN_CONTRACT_ERRORS.NotAuthorized)).toMatchObject({
      code: ErrorCodes.CHAIN_UNAUTHORIZED,
      statusCode: 403,
    });
  });
});

describe('v2 event verification schema', () => {
  it.each([
    { confirmations: 0, verified: false },
    { confirmations: 2, verified: false },
    { confirmations: 3, verified: true },
    { confirmations: 10, verified: true },
  ])('accepts %p', value => {
    expect(ChainEventVerificationSchema.parse(value)).toEqual(value);
  });

  it.each([
    { confirmations: -1, verified: false },
    { confirmations: 1.5, verified: true },
    { confirmations: 3 },
    { confirmations: 3, verified: 'yes' },
    { confirmations: 3, verified: true, extra: 1 },
  ])('rejects mutated verification %p', value => {
    expect(ChainEventVerificationSchema.safeParse(value).success).toBe(false);
  });
});
