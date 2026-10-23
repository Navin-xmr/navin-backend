import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Keypair, Networks } from '@stellar/stellar-sdk';
import type { SorobanAdapterOptions } from '../src/services/chain/soroban.adapter.js';

const ORIGINAL_ENV = { ...process.env };

const CONTRACT_ID = 'CACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAINCW';

/** Minimum env that passes boot validation with SOROBAN_ADAPTER=soroban. */
const SOROBAN_ENV = {
  SOROBAN_ADAPTER: 'soroban',
  SOROBAN_RPC_URL: 'https://soroban-rpc.example.test',
  ESCROW_CONTRACT_ID: CONTRACT_ID,
};

/**
 * Fresh env → config → factory graph for the given env overrides.
 * `registerMocks` runs after the module reset and before any import.
 */
async function loadFactory(
  overrides: Record<string, string | undefined>,
  registerMocks?: () => void
) {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...overrides };
  for (const [k, v] of Object.entries(overrides)) if (v === undefined) delete process.env[k];
  registerMocks?.();

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

  it('soroban → SorobanAdapter singleton, memoized until reset', async () => {
    const { factory } = await loadFactory(SOROBAN_ENV);
    const { SorobanAdapter } = await import('../src/services/chain/soroban.adapter.js');
    expect(factory.createChainAdapter('soroban')).toBeInstanceOf(SorobanAdapter);
    const first = factory.getChainAdapter();
    expect(first).toBeInstanceOf(SorobanAdapter);
    expect(factory.getChainAdapter()).toBe(first);

    factory.resetChainAdapter();
    expect(factory.getChainAdapter()).not.toBe(first);
  });

  it('soroban without SOROBAN_RPC_URL / ESCROW_CONTRACT_ID → rejected at boot', async () => {
    const exit = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    await expect(
      loadFactory({
        SOROBAN_ADAPTER: 'soroban',
        SOROBAN_RPC_URL: undefined,
        ESCROW_CONTRACT_ID: undefined,
      })
    ).rejects.toThrow('process.exit(1)');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('unknown value → rejected at boot by env validation', async () => {
    const exit = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    await expect(loadFactory({ SOROBAN_ADAPTER: 'ethereum' })).rejects.toThrow('process.exit(1)');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('explicit kind overrides config', async () => {
    const { factory, SimulatedAdapter } = await loadFactory(SOROBAN_ENV);
    expect(factory.createChainAdapter('simulated')).toBeInstanceOf(SimulatedAdapter);
  });
});

// Runs before the mocked-SorobanAdapter suite below: unstable_mockModule
// registrations leak across tests in this file, so real-instantiation
// assertions must execute before any test registers the SorobanAdapter mock.
describe('ChainAdapter factory — SorobanAdapter positive instantiation (#969)', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.restoreAllMocks();
  });

  it("createChainAdapter('soroban') returns a SorobanAdapter with RPC URL, contract and network from config", async () => {
    const { factory } = await loadFactory({
      ...SOROBAN_ENV,
      STELLAR_NETWORK: undefined,
      STELLAR_SECRET_KEY: undefined,
    });
    const { SorobanAdapter } = await import('../src/services/chain/soroban.adapter.js');

    const adapter = factory.createChainAdapter('soroban');

    expect(adapter).toBeInstanceOf(SorobanAdapter);
    const internals = adapter as unknown as {
      contractId: string;
      networkPassphrase: string;
      secretKey: string | undefined;
    };
    expect(internals.contractId).toBe(CONTRACT_ID);
    expect(internals.networkPassphrase).toBe(Networks.TESTNET);
    expect(internals.secretKey).toBeUndefined();
  });

  it('forwards custom RPC URL, contract id, signer and public network to SorobanAdapter', async () => {
    const signer = Keypair.random();
    const customContractId = 'CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5PNUCGLIMAO4K';
    const { factory } = await loadFactory({
      ...SOROBAN_ENV,
      STELLAR_NETWORK: 'public',
      SOROBAN_RPC_URL: 'https://mainnet-rpc.example.test',
      ESCROW_CONTRACT_ID: customContractId,
      STELLAR_SECRET_KEY: signer.secret(),
    });
    const { SorobanAdapter } = await import('../src/services/chain/soroban.adapter.js');

    const adapter = factory.createChainAdapter('soroban');

    expect(adapter).toBeInstanceOf(SorobanAdapter);
    const internals = adapter as unknown as {
      contractId: string;
      networkPassphrase: string;
      secretKey: string | undefined;
    };
    expect(internals.contractId).toBe(customContractId);
    expect(internals.networkPassphrase).toBe(Networks.PUBLIC);
    expect(internals.secretKey).toBe(signer.secret());
  });
});

describe('ChainAdapter factory — SorobanAdapter configuration', () => {
  /** Factory graph with SorobanAdapter swapped for a recorder of its constructor options. */
  async function loadWithSorobanSpy(overrides: Record<string, string | undefined>) {
    const SorobanAdapter = jest.fn<(options: SorobanAdapterOptions) => void>();
    const { factory } = await loadFactory(overrides, () => {
      jest.unstable_mockModule('../src/services/chain/soroban.adapter.js', () => ({
        SorobanAdapter,
      }));
    });
    return { factory, SorobanAdapter };
  }

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('defaults: testnet passphrase, no signer, RPC URL + contract from env', async () => {
    const { factory, SorobanAdapter } = await loadWithSorobanSpy({
      ...SOROBAN_ENV,
      STELLAR_NETWORK: undefined,
      STELLAR_SECRET_KEY: undefined,
    });

    const adapter = factory.getChainAdapter();

    expect(SorobanAdapter).toHaveBeenCalledTimes(1);
    expect(SorobanAdapter).toHaveBeenCalledWith({
      sorobanRpcUrl: SOROBAN_ENV.SOROBAN_RPC_URL,
      contractId: CONTRACT_ID,
      secretKey: undefined,
      networkPassphrase: Networks.TESTNET,
    });
    expect(adapter).toBe(SorobanAdapter.mock.instances[0]);
  });

  it('custom overrides: public network, RPC URL, contract and signer are forwarded', async () => {
    const signer = Keypair.random();
    const customContractId = 'CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5PNUCGLIMAO4K';
    const { factory, SorobanAdapter } = await loadWithSorobanSpy({
      ...SOROBAN_ENV,
      STELLAR_NETWORK: 'public',
      SOROBAN_RPC_URL: 'https://mainnet-rpc.example.test',
      ESCROW_CONTRACT_ID: customContractId,
      STELLAR_SECRET_KEY: signer.secret(),
    });

    factory.createChainAdapter('soroban');

    expect(SorobanAdapter).toHaveBeenCalledWith({
      sorobanRpcUrl: 'https://mainnet-rpc.example.test',
      contractId: customContractId,
      secretKey: signer.secret(),
      networkPassphrase: Networks.PUBLIC,
    });
  });

  it('simulated selection never constructs a SorobanAdapter', async () => {
    const { factory, SorobanAdapter } = await loadWithSorobanSpy({ SOROBAN_ADAPTER: 'simulated' });

    factory.getChainAdapter();

    expect(SorobanAdapter).not.toHaveBeenCalled();
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
