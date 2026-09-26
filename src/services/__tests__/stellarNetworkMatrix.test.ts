import { jest, describe, it, expect, beforeAll } from '@jest/globals';
import { Networks } from '@stellar/stellar-sdk';

/**
 * Network-matrix test for the Stellar service (issue #658, P6-10).
 *
 * The acceptance criterion is that both networks resolve *distinct* servers and
 * passphrases, and that they do so *consistently* — the server that receives a
 * transaction and the passphrase that signs it must always come from the same
 * network. Signing for mainnet while submitting to testnet (or the reverse) is
 * the fund-loss-class misconfiguration this file is here to make impossible.
 */

const TESTNET_HORIZON = 'https://horizon-testnet.stellar.org';
const PUBLIC_HORIZON = 'https://horizon.stellar.org';

jest.unstable_mockModule('../../config/index.js', () => ({
  config: {
    stellarNetwork: 'testnet',
    horizonUrl: TESTNET_HORIZON,
    sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
  },
}));

describe('stellar network matrix', () => {
  let resolveStellarNetworkTarget: (network: 'testnet' | 'public') => {
    horizonUrl: string;
    networkPassphrase: string;
  };
  let getHorizonServer: () => { serverURL: string };

  beforeAll(async () => {
    const mod = await import('../stellar.service.js');
    resolveStellarNetworkTarget =
      mod.resolveStellarNetworkTarget as typeof resolveStellarNetworkTarget;
    getHorizonServer = mod.getHorizonServer as unknown as typeof getHorizonServer;
  });

  it('resolves the testnet server together with the testnet passphrase', () => {
    const target = resolveStellarNetworkTarget('testnet');

    expect(target.horizonUrl).toBe(TESTNET_HORIZON);
    expect(target.networkPassphrase).toBe(Networks.TESTNET);
  });

  it('resolves the public server together with the public passphrase', () => {
    const target = resolveStellarNetworkTarget('public');

    expect(target.horizonUrl).toBe(PUBLIC_HORIZON);
    expect(target.networkPassphrase).toBe(Networks.PUBLIC);
  });

  it('keeps the two networks distinct in both values', () => {
    const testnet = resolveStellarNetworkTarget('testnet');
    const publicNet = resolveStellarNetworkTarget('public');

    expect(testnet.horizonUrl).not.toBe(publicNet.horizonUrl);
    expect(testnet.networkPassphrase).not.toBe(publicNet.networkPassphrase);

    // And neither network borrows the other's passphrase: this is the pair that
    // used to drift apart when the endpoint was hardcoded.
    expect(testnet.networkPassphrase).not.toBe(Networks.PUBLIC);
    expect(publicNet.networkPassphrase).not.toBe(Networks.TESTNET);
  });

  it('builds the server from the configured network, not from a fixed endpoint', () => {
    // The config mock above says testnet; the server must follow it.
    // `serverURL` is the SDK's URL object, and it normalises a bare origin to a
    // trailing slash.
    expect(String(getHorizonServer().serverURL)).toBe(`${TESTNET_HORIZON}/`);
  });

  it('gives every call its own server instance', () => {
    // A single instance built at import time is what allowed a stale endpoint to
    // survive a network change; the resolver must not cache one.
    expect(getHorizonServer()).not.toBe(getHorizonServer());
  });
});
