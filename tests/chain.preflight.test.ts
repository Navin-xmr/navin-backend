import { describe, expect, it, jest } from '@jest/globals';

import { parseChainPreflightChecks } from '../src/config/chainPreflight.js';
import type { ChainPreflightCheck } from '../src/config/chainPreflight.js';
import { runChainPreflight } from '../src/services/chain/preflight.js';
import type { ChainRole, ChainStateReader } from '../src/services/chain/preflight.js';
import { ErrorCodes } from '../src/shared/http/errors.js';

const ACTOR = 'GABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEJXA';
const TOKEN = 'CACQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQLC2U';
const ALL: ChainPreflightCheck[] = [
  'initialized',
  'roles',
  'whitelist',
  'suspension',
  'token_decimals',
];

interface ReaderState {
  initialized?: boolean;
  roles?: ChainRole[];
  whitelisted?: boolean;
  suspended?: boolean;
  decimals?: number;
}

function makeReader(state: ReaderState = {}) {
  const { initialized = true, roles = ['Company'], whitelisted = true } = state;
  const { suspended = false, decimals = 7 } = state;
  return {
    isInitialized: jest.fn(async () => initialized),
    hasRole: jest.fn(async (_address: string, role: ChainRole) => roles.includes(role)),
    isCarrierWhitelisted: jest.fn(async () => whitelisted),
    isSuspended: jest.fn(async () => suspended),
    getTokenDecimals: jest.fn(async () => decimals),
  } satisfies ChainStateReader;
}

const enabled = (checks: readonly ChainPreflightCheck[] = ALL) => ({ enabled: true, checks });

describe('runChainPreflight (#1081)', () => {
  it('does nothing and reads nothing when disabled', async () => {
    const reader = makeReader({ initialized: false });
    await runChainPreflight(reader, { actor: ACTOR, token: TOKEN }, { enabled: false, checks: ALL });
    expect(reader.isInitialized).not.toHaveBeenCalled();
  });

  it('passes for an initialized contract, a Company actor and a 7-decimal token', async () => {
    await expect(
      runChainPreflight(makeReader(), { actor: ACTOR, token: TOKEN }, enabled())
    ).resolves.toBeUndefined();
  });

  it('rejects an uninitialized contract with ERR_CHAIN_NOT_INITIALIZED (503)', async () => {
    await expect(
      runChainPreflight(makeReader({ initialized: false }), { actor: ACTOR }, enabled())
    ).rejects.toMatchObject({ statusCode: 503, code: ErrorCodes.CHAIN_NOT_INITIALIZED });
  });

  it('rejects an actor with neither role with ERR_CHAIN_ROLE_REQUIRED (403)', async () => {
    await expect(
      runChainPreflight(makeReader({ roles: [] }), { actor: ACTOR }, enabled())
    ).rejects.toMatchObject({
      statusCode: 403,
      code: ErrorCodes.CHAIN_ROLE_REQUIRED,
      details: { actor: ACTOR, requiredRoles: ['Company', 'Carrier'] },
    });
  });

  it('accepts a whitelisted Carrier and rejects one that is not', async () => {
    await expect(
      runChainPreflight(makeReader({ roles: ['Carrier'] }), { actor: ACTOR }, enabled())
    ).resolves.toBeUndefined();

    await expect(
      runChainPreflight(
        makeReader({ roles: ['Carrier'], whitelisted: false }),
        { actor: ACTOR },
        enabled()
      )
    ).rejects.toMatchObject({ statusCode: 403, code: ErrorCodes.CHAIN_CARRIER_NOT_WHITELISTED });
  });

  it('does not apply the carrier whitelist to an actor that is also a Company', async () => {
    const reader = makeReader({ roles: ['Company', 'Carrier'], whitelisted: false });
    await expect(runChainPreflight(reader, { actor: ACTOR }, enabled())).resolves.toBeUndefined();
    expect(reader.isCarrierWhitelisted).not.toHaveBeenCalled();
  });

  it('rejects a suspended actor with ERR_CHAIN_ACTOR_SUSPENDED (403)', async () => {
    await expect(
      runChainPreflight(makeReader({ suspended: true }), { actor: ACTOR }, enabled())
    ).rejects.toMatchObject({ statusCode: 403, code: ErrorCodes.CHAIN_ACTOR_SUSPENDED });
  });

  it('rejects a token that is not 7-decimal with ERR_CHAIN_INVALID_TOKEN_DECIMALS (422)', async () => {
    await expect(
      runChainPreflight(makeReader({ decimals: 6 }), { token: TOKEN }, enabled())
    ).rejects.toMatchObject({
      statusCode: 422,
      code: ErrorCodes.CHAIN_INVALID_TOKEN_DECIMALS,
      details: { token: TOKEN, decimals: 6, expected: 7 },
    });
  });

  it('only runs the configured checks', async () => {
    const reader = makeReader({ initialized: false, roles: [], suspended: true, decimals: 6 });
    await expect(
      runChainPreflight(reader, { actor: ACTOR, token: TOKEN }, enabled([]))
    ).resolves.toBeUndefined();
    expect(reader.isInitialized).not.toHaveBeenCalled();

    await expect(
      runChainPreflight(reader, { actor: ACTOR }, enabled(['suspension']))
    ).rejects.toMatchObject({ code: ErrorCodes.CHAIN_ACTOR_SUSPENDED });
    expect(reader.hasRole).not.toHaveBeenCalled();
  });

  it('skips a check whose input is absent', async () => {
    const reader = makeReader({ roles: [], suspended: true, decimals: 6 });
    await runChainPreflight(reader, {}, enabled(['roles', 'whitelist', 'suspension', 'token_decimals']));
    expect(reader.hasRole).not.toHaveBeenCalled();
    expect(reader.getTokenDecimals).not.toHaveBeenCalled();
  });

  it('reports the first failing check in order: initialized before roles', async () => {
    await expect(
      runChainPreflight(makeReader({ initialized: false, roles: [] }), { actor: ACTOR }, enabled())
    ).rejects.toMatchObject({ code: ErrorCodes.CHAIN_NOT_INITIALIZED });
  });
});

describe('parseChainPreflightChecks', () => {
  it('parses, trims and de-duplicates a comma list', () => {
    expect(parseChainPreflightChecks(' roles , initialized,roles ')).toEqual({
      checks: ['roles', 'initialized'],
      unknown: [],
    });
  });

  it('reports unknown names', () => {
    expect(parseChainPreflightChecks('roles,kyc')).toEqual({ checks: ['roles'], unknown: ['kyc'] });
  });

  it('an empty value means no checks', () => {
    expect(parseChainPreflightChecks('')).toEqual({ checks: [], unknown: [] });
  });
});
