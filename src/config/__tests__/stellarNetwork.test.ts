import { describe, it, expect } from '@jest/globals';
import { resolveStellarUrls } from '../stellarNetwork.js';

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
