import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Keypair } from '@stellar/stellar-sdk';

const ORIGINAL_ENV = { ...process.env };

/** Fresh env → config → factory graph for the given env overrides. */
async function loadFactory(overrides: Record<string, string | undefined>) {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...overrides };
  for (const [k, v] of Object.entries(overrides)) if (v === undefined) delete process.env[k];

  const { config } = await import('../src/config/index.js');
  const factory = await import('../src/services/chain/factory.js');
  const { SimulatedAdapter } = await import('../src/services/chain/simulated.adapter.js');
  const { AppError, ErrorCodes } = await import('../src/shared/http/errors.js');
  return { config, factory, SimulatedAdapter, AppError, ErrorCodes };
}

describe('ChainAdapter factory — SOROBAN_ADAPTER env matrix', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.restoreAllMocks();
  });

  it('unset → defaults to the simulated adapter', async () => {
    const { config, factory, SimulatedAdapter } = await loadFactory({ SOROBAN_ADAPTER: undefined });
    expect(config.chainAdapter).toBe('simulated');
    expect(factory.getChainAdapter()).toBeInstanceOf(SimulatedAdapter);
  });

  it('simulated → SimulatedAdapter, memoized until reset', async () => {
    const { factory, SimulatedAdapter } = await loadFactory({ SOROBAN_ADAPTER: 'simulated' });
    const first = factory.getChainAdapter();
    expect(first).toBeInstanceOf(SimulatedAdapter);
    expect(factory.getChainAdapter()).toBe(first);

    factory.resetChainAdapter();
    expect(factory.getChainAdapter()).not.toBe(first);
  });

  it('soroban → fails fast with ERR_CHAIN_UNKNOWN until SorobanAdapter lands', async () => {
    const { config, factory, AppError, ErrorCodes } = await loadFactory({
      SOROBAN_ADAPTER: 'soroban',
      SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
      ESCROW_CONTRACT_ID: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
    });
    expect(config.chainAdapter).toBe('soroban');

    let thrown: unknown;
    try {
      factory.getChainAdapter();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect(thrown).toMatchObject({ statusCode: 500, code: ErrorCodes.CHAIN_UNKNOWN });
  });

  it('unknown value → rejected at boot by env validation', async () => {
    const exit = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    await expect(loadFactory({ SOROBAN_ADAPTER: 'ethereum' })).rejects.toThrow('process.exit(1)');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('explicit kind overrides config', async () => {
    const { factory, SimulatedAdapter } = await loadFactory({
      SOROBAN_ADAPTER: 'soroban',
      SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
      ESCROW_CONTRACT_ID: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
    });
    expect(factory.createChainAdapter('simulated')).toBeInstanceOf(SimulatedAdapter);
  });
});

describe('getChainActorAddress', () => {
  const signer = Keypair.random();

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns the public key of the configured signing secret', async () => {
    const { factory } = await loadFactory({ STELLAR_SECRET_KEY: signer.secret() });
    expect(factory.getChainActorAddress()).toBe(signer.publicKey());
  });

  it('throws ERR_CHAIN_UNKNOWN when no signing secret is configured', async () => {
    const { factory, ErrorCodes } = await loadFactory({ STELLAR_SECRET_KEY: undefined });
    expect(() => factory.getChainActorAddress()).toThrow(
      expect.objectContaining({ code: ErrorCodes.CHAIN_UNKNOWN }) as never
    );
  });
});
