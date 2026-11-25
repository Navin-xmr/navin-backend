import { describe, expect, it } from '@jest/globals';

import { loadContractRegistry, resolveContractRegistry } from '../../src/config/contractRegistry.js';

describe('chain contract registry (P15-01)', () => {
  it('loads committed testnet IDs with WASM hashes and source commit', () => {
    const testnet = resolveContractRegistry('testnet');
    expect(testnet.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
    for (const kind of ['shipment', 'token', 'nft'] as const) {
      expect(testnet.contracts[kind].id).toMatch(/^C[A-Z2-7]{55}$/);
      expect(testnet.contracts[kind].wasmHash).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(loadContractRegistry().version).toBe(1);
  });

  it('rejects a configured ID that mismatches the registry entry', () => {
    expect(() =>
      resolveContractRegistry('testnet', { shipment: 'C'.padEnd(56, 'Z') })
    ).toThrow(/does not match testnet registry/);
  });

  it('rejects an unknown network', () => {
    expect(() => resolveContractRegistry('local')).toThrow(/Unknown contract registry network/);
  });

  it('accepts matching configured IDs (startup verification passes)', () => {
    const expected = resolveContractRegistry('testnet').contracts.token.id;
    expect(resolveContractRegistry('testnet', { token: expected }).contracts.token.id).toBe(expected);
  });
});
