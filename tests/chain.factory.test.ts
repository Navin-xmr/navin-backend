import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Keypair, Networks } from '@stellar/stellar-sdk';

const ORIGINAL_ENV = { ...process.env };

/** Fresh env → config → factory graph for the given env overrides. */
async function loadFactory(overrides: Record<string, string | undefined>) {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...overrides };
  for (const [k, v] of Object.entries(overrides)) if (v === undefined) delete process.env[k];

  const { config } = await import('../src/config/index.js');
  const factory = await import('../src/services/chain/factory.js');
  const { SimulatedAdapter } = await import('../src/services/chain/simulated.adapter.js');
  const { SorobanAdapter } = await import('../src/services/chain/soroban.adapter.js');
  const { AppError, ErrorCodes } = await import('../src/shared/http/errors.js');
  return { config, factory, SimulatedAdapter, SorobanAdapter, AppError, ErrorCodes };
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

  it('soroban → configures SorobanAdapter with default config options', async () => {
    const signer = Keypair.random();
    const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';
    const { config, factory, SorobanAdapter } = await loadFactory({
      SOROBAN_ADAPTER: 'soroban',
      STELLAR_NETWORK: 'testnet',
      SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
      ESCROW_CONTRACT_ID: contractId,
      STELLAR_SECRET_KEY: signer.secret(),
    });
    expect(config.chainAdapter).toBe('soroban');

    const adapter = factory.getChainAdapter();
    expect(adapter).toBeInstanceOf(SorobanAdapter);
    expect(factory.getChainAdapter()).toBe(adapter);

    const internal = adapter as unknown as {
      server: { serverURL: { toString(): string } };
      contractId: string;
      secretKey: string;
      networkPassphrase: string;
    };
    expect(internal.server.serverURL.toString()).toBe('https://soroban-testnet.stellar.org/');
    expect(internal.contractId).toBe(contractId);
    expect(internal.secretKey).toBe(signer.secret());
    expect(internal.networkPassphrase).toBe(Networks.TESTNET);
  });

  it('soroban → forwards customized config and explicit option overrides to SorobanAdapter', async () => {
    const envSigner = Keypair.random();
    const overrideSigner = Keypair.random();
    const envContractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';
    const overrideContractId = 'CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBMJ4A';

    const { factory, SorobanAdapter } = await loadFactory({
      SOROBAN_ADAPTER: 'soroban',
      STELLAR_NETWORK: 'public',
      SOROBAN_RPC_URL: 'https://custom-rpc.mainnet.stellar.org',
      ESCROW_CONTRACT_ID: envContractId,
      STELLAR_SECRET_KEY: envSigner.secret(),
    });

    const fromEnv = factory.createChainAdapter('soroban');
    expect(fromEnv).toBeInstanceOf(SorobanAdapter);
    const fromEnvInternal = fromEnv as unknown as {
      server: { serverURL: { toString(): string } };
      contractId: string;
      secretKey: string;
      networkPassphrase: string;
    };
    expect(fromEnvInternal.server.serverURL.toString()).toBe(
      'https://custom-rpc.mainnet.stellar.org/'
    );
    expect(fromEnvInternal.contractId).toBe(envContractId);
    expect(fromEnvInternal.secretKey).toBe(envSigner.secret());
    expect(fromEnvInternal.networkPassphrase).toBe(Networks.PUBLIC);

    const fromOverrides = factory.createChainAdapter('soroban', {
      sorobanRpcUrl: 'https://override-rpc.testnet.stellar.org',
      contractId: overrideContractId,
      secretKey: overrideSigner.secret(),
      stellarNetwork: 'testnet',
    });
    const fromOverridesInternal = fromOverrides as unknown as {
      server: { serverURL: { toString(): string } };
      contractId: string;
      secretKey: string;
      networkPassphrase: string;
    };
    expect(fromOverridesInternal.server.serverURL.toString()).toBe(
      'https://override-rpc.testnet.stellar.org/'
    );
    expect(fromOverridesInternal.contractId).toBe(overrideContractId);
    expect(fromOverridesInternal.secretKey).toBe(overrideSigner.secret());
    expect(fromOverridesInternal.networkPassphrase).toBe(Networks.TESTNET);
  });

  it('unknown value → rejected at boot by env validation', async () => {
    const exit = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    await expect(loadFactory({ SOROBAN_ADAPTER: 'ethereum' })).rejects.toThrow('process.exit(1)');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('explicit kind overrides config', async () => {
    const { factory, SimulatedAdapter, SorobanAdapter } = await loadFactory({
      SOROBAN_ADAPTER: 'soroban',
      SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
      ESCROW_CONTRACT_ID: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
    });
    expect(factory.createChainAdapter('simulated')).toBeInstanceOf(SimulatedAdapter);
    expect(factory.createChainAdapter('soroban')).toBeInstanceOf(SorobanAdapter);
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
