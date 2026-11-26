import { describe, it, expect } from '@jest/globals';
import { Networks } from '@stellar/stellar-sdk';
import {
  resolveSorobanConfig,
  resolveStellarUrls,
  stellarNetworkPassphrase,
} from '../stellarNetwork.js';

describe('resolveStellarUrls', () => {
  it('resolves testnet Horizon/Soroban URLs', () => {
    expect(resolveStellarUrls('testnet')).toEqual({
      horizonUrl: 'https://horizon-testnet.stellar.org',
      sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
    });
  });

  it('resolves public (mainnet) Horizon/Soroban URLs', () => {
    expect(resolveStellarUrls('public')).toEqual({
      horizonUrl: 'https://horizon.stellar.org',
      sorobanRpcUrl: 'https://mainnet.sorobanrpc.com',
    });
  });

  it('lets HORIZON_URL/SOROBAN_RPC_URL overrides win independently of network defaults', () => {
    expect(
      resolveStellarUrls('testnet', { horizonUrl: 'https://custom-horizon.example.com' })
    ).toEqual({
      horizonUrl: 'https://custom-horizon.example.com',
      sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
    });

    expect(
      resolveStellarUrls('public', { sorobanRpcUrl: 'https://custom-soroban.example.com' })
    ).toEqual({
      horizonUrl: 'https://horizon.stellar.org',
      sorobanRpcUrl: 'https://custom-soroban.example.com',
    });
  });

  it('throws for an unknown network', () => {
    expect(() => resolveStellarUrls('devnet')).toThrow(/Unknown STELLAR_NETWORK "devnet"/);
  });
});

describe('stellarNetworkPassphrase', () => {
  it('maps each network to its SDK passphrase', () => {
    expect(stellarNetworkPassphrase('testnet')).toBe(Networks.TESTNET);
    expect(stellarNetworkPassphrase('public')).toBe(Networks.PUBLIC);
  });
});

describe('resolveSorobanConfig (#995)', () => {
  it('derives RPC URL and passphrase for testnet', () => {
    expect(resolveSorobanConfig('testnet')).toEqual({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: Networks.TESTNET,
    });
  });

  it('derives RPC URL and passphrase for public', () => {
    expect(resolveSorobanConfig('public')).toEqual({
      rpcUrl: 'https://mainnet.sorobanrpc.com',
      networkPassphrase: Networks.PUBLIC,
    });
  });

  it('gives explicit overrides precedence over network defaults', () => {
    expect(
      resolveSorobanConfig('testnet', {
        rpcUrl: 'https://custom-soroban.example.com',
        networkPassphrase: 'custom passphrase',
      })
    ).toEqual({
      rpcUrl: 'https://custom-soroban.example.com',
      networkPassphrase: 'custom passphrase',
    });
    expect(resolveSorobanConfig('public', { rpcUrl: 'https://other.example.com' })).toEqual({
      rpcUrl: 'https://other.example.com',
      networkPassphrase: Networks.PUBLIC,
    });
  });

  it('throws for an unknown network', () => {
    expect(() => resolveSorobanConfig('devnet')).toThrow(/Unknown STELLAR_NETWORK "devnet"/);
  });
});
