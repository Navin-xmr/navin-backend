import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { AppError, ErrorCodes } from '../src/shared/http/errors.js';
import {
  CHAIN_CONTRACT_ERRORS,
  CHAIN_ERROR_MAP,
  CHAIN_EVENT_NAMES,
  CHAIN_FUNCTION_AUTH,
  CHAIN_FUNCTIONS,
  CHAIN_SPEC_VERSION,
  ChainContractErrorSchema,
  ChainEventSchema,
  ChainFunctionArgsSchemas,
  ChainTxResultSchema,
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

const G_OTHER = 'GABQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQHGPC';
const I128_OVERFLOW = ((BigInt(1) << BigInt(127)) - BigInt(1) + BigInt(1)).toString();

describe('chain spec version pin', () => {
  it.each([
    ['functions.json', functions.spec_version],
    ['events.json', events.spec_version],
    ['errors.json', errors.spec_version],
  ])('%s is pinned to CHAIN_SPEC_VERSION', (_file, version) => {
    expect(version).toBe(CHAIN_SPEC_VERSION);
  });
});

describe('chain function payloads', () => {
  it('has a fixture, schema and auth rule for every spec function', () => {
    for (const fn of CHAIN_FUNCTIONS) {
      expect(functions.args[fn]).toBeDefined();
      expect(ChainFunctionArgsSchemas[fn]).toBeDefined();
      expect(CHAIN_FUNCTION_AUTH[fn]).toBeDefined();
    }
  });

  describe.each(CHAIN_FUNCTIONS.map(fn => [fn] as const))('%s', fn => {
    const schema = ChainFunctionArgsSchemas[fn];
    const fixture = functions.args[fn];

    it('valid fixture round-trips unchanged', () => {
      const parsed = schema.parse(fixture);
      expect(parsed).toEqual(fixture);
      expect(schema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(fixture);
    });

    it.each(Object.keys(fixture))('rejects when "%s" is missing', key => {
      expect(schema.safeParse(without(fixture, key)).success).toBe(false);
    });

    it('rejects unknown fields (spec drift)', () => {
      expect(schema.safeParse({ ...fixture, extra: 'x' }).success).toBe(false);
    });
  });

  it.each([
    ['anchor', 'data_hash', functions.args.anchor.data_hash!.toString().toUpperCase()],
    ['anchor', 'data_hash', 'ab'.repeat(31)],
    ['anchor', 'shipment_id', 'has-dash'],
    ['anchor', 'shipment_id', 'x'.repeat(33)],
    ['anchor', 'actor', 'GBAD'],
    ['init_escrow', 'amount', '0'],
    ['init_escrow', 'amount', '-1'],
    ['init_escrow', 'amount', '1.5'],
    ['init_escrow', 'amount', 1500000000],
    ['init_escrow', 'amount', I128_OVERFLOW],
    ['init_escrow', 'token', G_OTHER],
    ['release_escrow', 'proof_hash', ''],
  ] as const)('%s rejects mutated %s = %p', (fn, key, value) => {
    const mutated = { ...functions.args[fn], [key]: value };
    expect(ChainFunctionArgsSchemas[fn].safeParse(mutated).success).toBe(false);
  });

  it('init_escrow rejects payer === payee', () => {
    const args = functions.args.init_escrow;
    expect(
      ChainFunctionArgsSchemas.init_escrow.safeParse({ ...args, payee: args.payer }).success
    ).toBe(false);
  });

  it('accepts the i128 upper bound', () => {
    const max = ((BigInt(1) << BigInt(127)) - BigInt(1)).toString();
    expect(
      ChainFunctionArgsSchemas.init_escrow.safeParse({ ...functions.args.init_escrow, amount: max })
        .success
    ).toBe(true);
  });

  describe('tx result', () => {
    it('valid fixture round-trips unchanged', () => {
      expect(ChainTxResultSchema.parse(functions.tx_result)).toEqual(functions.tx_result);
    });

    it.each([-1, 1.5, 0x100000000, '512345'])('rejects ledger = %p', ledger => {
      expect(ChainTxResultSchema.safeParse({ ...functions.tx_result, ledger }).success).toBe(false);
    });
  });
});

describe('chain events', () => {
  const names = Object.values(CHAIN_EVENT_NAMES);

  it('has a fixture for every spec event', () => {
    expect(Object.keys(events.events).sort()).toEqual([...names].sort());
  });

  describe.each(names.map(n => [n] as const))('%s', name => {
    const fixture = events.events[name]!;

    it('valid fixture round-trips unchanged', () => {
      const parsed = ChainEventSchema.parse(fixture);
      expect(parsed).toEqual(fixture);
      expect(parseChainEvent(JSON.parse(JSON.stringify(parsed)))).toEqual(fixture);
    });

    it.each(Object.keys(fixture))('rejects when "%s" is missing', key => {
      expect(ChainEventSchema.safeParse(without(fixture, key)).success).toBe(false);
    });

    it('rejects unknown fields (spec drift)', () => {
      expect(ChainEventSchema.safeParse({ ...fixture, extra: 1 }).success).toBe(false);
    });

    it('rejects a topic name that disagrees with the event name', () => {
      const topic = clone(fixture.topic as unknown[]);
      topic[0] = names.find(n => n !== name);
      expect(ChainEventSchema.safeParse({ ...fixture, topic }).success).toBe(false);
    });

    it('rejects data tuples with an extra or missing element', () => {
      const data = fixture.data as unknown[];
      expect(ChainEventSchema.safeParse({ ...fixture, data: [...data, 'x'] }).success).toBe(false);
      expect(ChainEventSchema.safeParse({ ...fixture, data: data.slice(0, -1) }).success).toBe(
        false
      );
    });

    it('rejects a non-ISO ledger_closed_at', () => {
      expect(
        ChainEventSchema.safeParse({ ...fixture, ledger_closed_at: '27/09/2026' }).success
      ).toBe(false);
    });
  });

  it('rejects an anchor event whose data_hash is malformed', () => {
    const fixture = clone(events.events.anchor!);
    (fixture.data as unknown[])[0] = 'not-a-hash';
    expect(ChainEventSchema.safeParse(fixture).success).toBe(false);
  });

  it('rejects an unknown event name', () => {
    expect(ChainEventSchema.safeParse({ ...events.events.anchor, name: 'mint' }).success).toBe(
      false
    );
  });

  it('parseChainEvent throws AppError(502, ERR_CHAIN_INVALID_EVENT) on mismatch', () => {
    let thrown: unknown;
    try {
      parseChainEvent({ ...events.events.anchor, ledger: -1 });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect(thrown).toMatchObject({ statusCode: 502, code: ErrorCodes.CHAIN_INVALID_EVENT });
  });
});

describe('chain errors', () => {
  it('has a fixture and backend mapping for every contract error', () => {
    const fixtureCodes = errors.errors.map(e => e.code).sort();
    expect(fixtureCodes).toEqual(Object.values(CHAIN_CONTRACT_ERRORS).sort());
    expect(Object.keys(CHAIN_ERROR_MAP).sort()).toEqual(Object.keys(CHAIN_CONTRACT_ERRORS).sort());
  });

  it.each(errors.errors.map(e => [e.code, e] as const))(
    'error fixture %p round-trips unchanged',
    (_code, fixture) => {
      expect(ChainContractErrorSchema.parse(fixture)).toEqual(fixture);
    }
  );

  it.each([
    { code: 99, function: 'anchor' },
    { code: '1', function: 'anchor' },
    { code: 1, function: 'transfer' },
    { code: 1 },
    { code: 1, function: 'anchor', extra: true },
  ])('rejects mutated error %p', mutated => {
    expect(ChainContractErrorSchema.safeParse(mutated).success).toBe(false);
  });

  it('maps every contract error to a registered ERR_CHAIN_* AppError', () => {
    const registered = new Set<string>(Object.values(ErrorCodes));
    for (const [name, code] of Object.entries(CHAIN_CONTRACT_ERRORS)) {
      const err = chainErrorToAppError(code);
      const expected = CHAIN_ERROR_MAP[name as keyof typeof CHAIN_ERROR_MAP];
      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe(expected.code);
      expect(err.statusCode).toBe(expected.status);
      expect(err.code).toMatch(/^ERR_CHAIN_/);
      expect(registered.has(err.code)).toBe(true);
    }
  });

  it('maps an out-of-spec contract code to ERR_CHAIN_UNKNOWN (502)', () => {
    const err = chainErrorToAppError(999);
    expect(err.code).toBe(ErrorCodes.CHAIN_UNKNOWN);
    expect(err.statusCode).toBe(502);
    expect(err.details).toEqual({ contractCode: 999 });
  });
});
