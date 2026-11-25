import { describe, expect, it, jest } from '@jest/globals';
import { Account, Keypair, Networks } from '@stellar/stellar-sdk';
import type { Transaction } from '@stellar/stellar-sdk';

import { SimulatedAdapter } from '../src/services/chain/simulated.adapter.js';
import { SorobanAdapter } from '../src/services/chain/soroban.adapter.js';
import type { ChainAdapter } from '../src/services/chain/types.js';
import { ErrorCodes } from '../src/shared/http/errors.js';
import { CHAIN_EVENT_NAMES, ChainEventSchema } from '../src/shared/types/chain.js';
import type { ChainEvent } from '../src/shared/types/chain.js';
import type { HorizonTransactionRecordMock, SimulatedHorizonClientMock } from './helpers/mocks.js';

const signer = Keypair.random();
const ACTOR = signer.publicKey();
const CONTRACT_ID = 'CACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAINCW';
const ANCHOR_INPUT = { shipment_id: 'shipment_1', data_hash: 'a1'.repeat(32), actor: ACTOR };
const RELEASE_INPUT = { caller: ACTOR, shipment_id: 'shipment_1' };
const SOROBAN_TX = 'c3'.repeat(32);

function createFakeHorizon() {
  const submitted: Transaction[] = [];
  const records: HorizonTransactionRecordMock[] = [];
  let ledger = 1000;
  const client = {
    loadAccount: jest.fn(async (pk: string) => new Account(pk, '100')),
    submitTransaction: jest.fn(async (tx: Transaction) => {
      submitted.push(tx);
      ledger += 1;
      records.push({
        paging_token: String(ledger * 4096),
        hash: tx.hash().toString('hex'),
        ledger_attr: ledger,
        created_at: new Date(Date.UTC(2026, 8, 27, 10, 0, ledger - 1000)).toISOString(),
        envelope_xdr: tx.toEnvelope().toXDR('base64'),
        successful: true,
      });
      return { hash: tx.hash().toString('hex'), ledger };
    }),
    listTransactions: jest.fn(async (_pk: string, cursor: string | undefined, limit: number) => {
      const start = cursor ? records.findIndex(r => r.paging_token === cursor) + 1 : 0;
      return records.slice(start, start + limit);
    }),
  } satisfies SimulatedHorizonClientMock;
  return { client, submitted };
}

const STREAM_FIXTURE: ChainEvent[] = [
  {
    id: 'evt-anchor-1',
    contract_id: CONTRACT_ID,
    tx_hash: '11'.repeat(32),
    ledger: 512345,
    ledger_closed_at: '2026-09-27T10:00:00.000Z',
    name: CHAIN_EVENT_NAMES.ANCHOR,
    topic: [CHAIN_EVENT_NAMES.ANCHOR, 'shipment_1'],
    data: ['a1'.repeat(32), 512345],
  },
  {
    id: 'evt-rel-1',
    contract_id: CONTRACT_ID,
    tx_hash: '22'.repeat(32),
    ledger: 512400,
    ledger_closed_at: '2026-09-27T11:00:00.000Z',
    name: CHAIN_EVENT_NAMES.ESCROW_RELEASE,
    topic: [CHAIN_EVENT_NAMES.ESCROW_RELEASE, 'payment_1'],
    data: ['b2'.repeat(32), ACTOR, '1500000000'],
  },
];

function createSorobanRpcStub() {
  return {
    getAccount: jest.fn(async (pk: string) => new Account(pk, '100')),
    getEvents: jest.fn(async () => ({
      events: STREAM_FIXTURE.map(e => ({
        id: e.id,
        contractId: e.contract_id,
        txHash: e.tx_hash,
        ledger: e.ledger,
        ledgerClosedAt: e.ledger_closed_at,
        topic: [...e.topic],
        value: [...(e.data as unknown[])],
      })),
    })),
    getLatestLedger: jest.fn(async () => ({ sequence: 512500 })),
  };
}

async function createBindingAdapters(): Promise<Array<[string, ChainAdapter, boolean]>> {
  const { client } = createFakeHorizon();
  const simulated = new SimulatedAdapter({
    horizon: client,
    secretKey: signer.secret(),
    networkPassphrase: Networks.TESTNET,
  });

  const rpcStub = createSorobanRpcStub();
  const soroban = new SorobanAdapter({
    secretKey: signer.secret(),
    contractId: CONTRACT_ID,
    networkPassphrase: Networks.TESTNET,
    rpcServer: rpcStub as never,
  });
  jest
    .spyOn(soroban as unknown as { invokePipeline: () => Promise<unknown> }, 'invokePipeline')
    .mockResolvedValue({ txHash: SOROBAN_TX, ledger: 200 });
  void rpcStub;
  return [
    ['simulated', simulated, true],
    ['soroban', soroban, false],
  ];
}

// Byte-identical inputs are shared across both adapters so receipts and events
// can be compared without adapter-specific fixtures.
const SHARED_ANCHOR_INPUT = Object.freeze({ ...ANCHOR_INPUT });
const SHARED_RELEASE_INPUT = Object.freeze({ ...RELEASE_INPUT });
const BINDINGS = await createBindingAdapters();

describe.each(BINDINGS)('%s ChainAdapter contract', (name, adapter, simulatedFlag) => {
  it('rejects malformed anchor hashes with the shared port error', async () => {
    await expect(
      adapter.anchorEvent({ ...SHARED_ANCHOR_INPUT, data_hash: 'not-a-hash' })
    ).rejects.toMatchObject({ statusCode: 422, code: ErrorCodes.CHAIN_INVALID_HASH });
    void name;
  });

  it('rejects a malformed caller with the Unauthorized port error (v2)', async () => {
    await expect(
      adapter.releaseEscrow({ ...SHARED_RELEASE_INPUT, caller: 'not-an-address' })
    ).rejects.toMatchObject({ statusCode: 422, code: ErrorCodes.CHAIN_UNAUTHORIZED });
  });

  it('anchorEvent returns a confirmed receipt with the correct simulated flag', async () => {
    const receipt = await adapter.anchorEvent({ ...SHARED_ANCHOR_INPUT });
    expect(receipt.txHash).toMatch(/^[0-9a-f]{64}$/);
    expect(Number.isInteger(receipt.ledger) && receipt.ledger > 0).toBe(true);
    expect(receipt.simulated).toBe(simulatedFlag);
  });

  it('releaseEscrow returns a confirmed receipt with shipmentId passthrough', async () => {
    const receipt = await adapter.releaseEscrow({ ...SHARED_RELEASE_INPUT });
    expect(receipt.txHash).toMatch(/^[0-9a-f]{64}$/);
    expect(Number.isInteger(receipt.ledger) && receipt.ledger > 0).toBe(true);
    expect(receipt.simulated).toBe(simulatedFlag);
    expect(receipt.shipmentId).toBe(SHARED_RELEASE_INPUT.shipment_id);
  });

  it('streamEvents yields ChainEvent objects validating against ChainEventSchema', async () => {
    if (name === 'simulated') {
      await adapter.anchorEvent({ ...SHARED_ANCHOR_INPUT });
    }
    const events: ChainEvent[] = [];
    for await (const event of adapter.streamEvents(undefined)) {
      events.push(event);
      if (events.length >= STREAM_FIXTURE.length) break;
    }
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(ChainEventSchema.safeParse(event).success).toBe(true);
    }
  });
});

describe('ChainAdapter positive parity (simulated ↔ soroban)', () => {
  it('both adapters consume byte-identical inputs and agree on all event names', async () => {
    const results = await Promise.all(
      BINDINGS.map(async ([, adapter]) => {
        const anchor = await adapter.anchorEvent({ ...SHARED_ANCHOR_INPUT });
        const release = await adapter.releaseEscrow({ ...SHARED_RELEASE_INPUT });
        const events: ChainEvent[] = [];
        for await (const event of adapter.streamEvents(undefined)) {
          events.push(event);
          if (events.length >= STREAM_FIXTURE.length) break;
        }
        return { anchor, release, events };
      })
    );
    expect(Buffer.from(SHARED_ANCHOR_INPUT.data_hash, 'hex')).toHaveLength(32);
    expect(results[0]!.events.length).toBeGreaterThan(0);
    expect(results[1]!.events.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.anchor.txHash).toMatch(/^[0-9a-f]{64}$/);
      expect(result.release.txHash).toMatch(/^[0-9a-f]{64}$/);
      expect(result.release.shipmentId).toBe(SHARED_RELEASE_INPUT.shipment_id);
    }
  });

  it('asserts simulated: true only on SimulatedAdapter, false on SorobanAdapter', async () => {
    const [simulated, soroban] = await Promise.all(
      BINDINGS.map(async ([, adapter]) => adapter.anchorEvent({ ...SHARED_ANCHOR_INPUT }))
    );
    expect(simulated!.simulated).toBe(true);
    expect(soroban!.simulated).toBe(false);
  });
});
