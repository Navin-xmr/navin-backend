import { describe, expect, it } from '@jest/globals';
import { createChainAdapterMock, createChainFactoryMock } from './mocks.js';
import type { ChainEvent } from '../../src/shared/types/chain.js';

const SAMPLE_EVENTS: ChainEvent[] = [
  {
    id: 'evt-1',
    type: 'event_anchored',
    tx_hash: '1'.repeat(64),
    ledger: 10,
    timestamp: 1_700_000_000,
    shipment_id: 'ship-1',
    data_hash: '2'.repeat(64),
    actor: 'GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H',
  },
  {
    id: 'evt-2',
    type: 'escrow_released',
    tx_hash: '3'.repeat(64),
    ledger: 11,
    timestamp: 1_700_000_010,
    payment_id: 'pay-1',
    shipment_id: 'ship-1',
    amount: '100',
    token: 'USDC',
    recipient: 'GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H',
  },
];

describe('createChainAdapterMock & createChainFactoryMock', () => {
  it('resolves simulated anchor and release receipts by default', async () => {
    const adapter = createChainAdapterMock();

    const anchorRes = await adapter.anchorEvent({
      shipment_id: 'ship-1',
      data_hash: 'a'.repeat(64),
      actor: 'G-ACTOR',
    });
    expect(anchorRes).toEqual({
      txHash: 'a'.repeat(64),
      ledger: 1,
      simulated: true,
    });

    const releaseRes = await adapter.releaseEscrow({
      payment_id: 'pay-42',
      proof_hash: 'b'.repeat(64),
    });
    expect(releaseRes).toEqual({
      txHash: 'a'.repeat(64),
      ledger: 1,
      simulated: true,
      paymentId: 'pay-42',
    });
  });

  it('supports scriptable results, transient failure counts, and cursor-aware event injection', async () => {
    const adapter = createChainAdapterMock(
      {},
      {
        anchorFailures: 1,
        releaseFailures: 1,
        anchorResult: { txHash: 'c'.repeat(64), ledger: 99, simulated: false },
        releaseResult: { txHash: 'd'.repeat(64), ledger: 100, simulated: false },
        events: SAMPLE_EVENTS,
      }
    );

    await expect(
      adapter.anchorEvent({ shipment_id: 's', data_hash: 'a'.repeat(64), actor: 'G' })
    ).rejects.toMatchObject({ statusCode: 502, code: 'ERR_CHAIN_UNKNOWN' });

    await expect(
      adapter.anchorEvent({ shipment_id: 's', data_hash: 'a'.repeat(64), actor: 'G' })
    ).resolves.toEqual({ txHash: 'c'.repeat(64), ledger: 99, simulated: false });

    await expect(
      adapter.releaseEscrow({ payment_id: 'pay-9', proof_hash: 'b'.repeat(64) })
    ).rejects.toMatchObject({ statusCode: 502, code: 'ERR_CHAIN_UNKNOWN' });

    await expect(
      adapter.releaseEscrow({ payment_id: 'pay-9', proof_hash: 'b'.repeat(64) })
    ).resolves.toEqual({
      txHash: 'd'.repeat(64),
      ledger: 100,
      simulated: false,
      paymentId: 'pay-9',
    });

    const afterEvt1: ChainEvent[] = [];
    for await (const ev of adapter.streamEvents('evt-1') as AsyncIterable<ChainEvent>) {
      afterEvt1.push(ev);
    }
    expect(afterEvt1).toEqual([SAMPLE_EVENTS[1]]);
  });

  it('wires adapter into createChainFactoryMock', () => {
    const adapter = createChainAdapterMock();
    const factory = createChainFactoryMock(adapter);

    expect(factory.getChainAdapter()).toBe(adapter);
    expect(factory.createChainAdapter()).toBe(adapter);
    expect(typeof factory.getChainActorAddress()).toBe('string');
  });
});
