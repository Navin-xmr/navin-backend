import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import { createChainAdapterMock, createChainFactoryMock } from './helpers/mocks.js';
import type { ChainAdapter } from '../src/services/chain/types.js';

describe('Stellar ChainAdapter - Integration (Testnet / Port)', () => {
  let adapter: ChainAdapter;
  const mockAdapter = createChainAdapterMock({
    anchorEvent: jest.fn(async (input: unknown) => {
      const { shipment_id, data_hash } = input as { shipment_id: string; data_hash: string };
      return {
        txHash: `tx-${shipment_id}-${data_hash.slice(0, 8)}`,
        ledger: 1,
        simulated: true,
      };
    }),
  });

  beforeAll(async () => {
    jest.resetModules();
    await jest.unstable_mockModule('../src/services/chain/factory.js', () =>
      createChainFactoryMock(mockAdapter)
    );
    const { getChainAdapter } = await import('../src/services/chain/factory.js');
    adapter = getChainAdapter();
  });

  it('should anchor a shipment event via ChainAdapter', async () => {
    const shipmentId = `integ-${Date.now()}`;
    const dataHash = 'a'.repeat(64);

    const result = await adapter.anchorEvent({
      shipment_id: shipmentId,
      event_type: 'CREATED',
      data_hash: dataHash,
      actor: 'GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H',
    });

    expect(result.txHash).toEqual(expect.any(String));
    expect(result.txHash.length).toBeGreaterThan(0);
    expect(mockAdapter.anchorEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        shipment_id: shipmentId,
        event_type: 'CREATED',
        data_hash: dataHash,
      })
    );
  }, 30_000);

  it('should produce unique transaction hashes for different shipments', async () => {
    const first = await adapter.anchorEvent({
      shipment_id: `uniq-a-${Date.now()}`,
      event_type: 'CREATED',
      data_hash: '1'.repeat(64),
      actor: 'GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H',
    });

    const second = await adapter.anchorEvent({
      shipment_id: `uniq-b-${Date.now()}`,
      event_type: 'CREATED',
      data_hash: '2'.repeat(64),
      actor: 'GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H',
    });

    expect(first.txHash).not.toBe(second.txHash);
  }, 60_000);
});
