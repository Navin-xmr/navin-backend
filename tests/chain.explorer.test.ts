import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const HASH = 'a'.repeat(64);

async function loadExplorer(stellarNetwork: 'testnet' | 'public') {
  jest.resetModules();
  await jest.unstable_mockModule('../src/config/index.js', () => ({
    config: { stellarNetwork },
  }));
  return import('../src/services/chain/explorer.js');
}

describe('getStellarExplorerUrl', () => {
  beforeEach(() => jest.resetModules());

  it('links to the testnet explorer on testnet', async () => {
    const { getStellarExplorerUrl } = await loadExplorer('testnet');
    expect(getStellarExplorerUrl(HASH)).toBe(`https://stellar.expert/explorer/testnet/tx/${HASH}`);
  });

  it('links to the public explorer on mainnet', async () => {
    const { getStellarExplorerUrl } = await loadExplorer('public');
    expect(getStellarExplorerUrl(HASH)).toBe(`https://stellar.expert/explorer/public/tx/${HASH}`);
  });
});
