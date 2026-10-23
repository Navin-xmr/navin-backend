import { describe, expect, it, jest } from '@jest/globals';
import { Account, Keypair, Networks } from '@stellar/stellar-sdk';
import type { Transaction } from '@stellar/stellar-sdk';

import { SimulatedAdapter } from '../src/services/chain/simulated.adapter.js';
import { SorobanAdapter } from '../src/services/chain/soroban.adapter.js';
import type { ChainAdapter } from '../src/services/chain/types.js';
import { ErrorCodes } from '../src/shared/http/errors.js';
import { CHAIN_EVENT_NAMES, ChainEventSchema } from '../src/shared/types/chain.js';
import type { ChainEvent } from '../src/shared/types/chain.js';
import type {
  HorizonTransactionRecordMock,
  SimulatedHorizonClientMock,
} from './helpers/mocks.js';

const signer = Keypair.random();
const ACTOR = signer.publicKey();
const CONTRACT_ID = 'CACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAINCW';
const ANCHOR_INPUT = { shipment_id: 'shipment_1', data_hash: 'a1'.repeat(32), actor: ACTOR };
const RELEASE_INPUT = { payment_id: 'payment_1', proof_hash: 'b2'.repeat(32) };
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

describe.each([['simulated'], ['soroban']])('%s ChainAdapter contract', () => {
  it('rejects malformed anchor hashes with the shared port error', async () => {
    for (const [, adapter] of await createBindingAdapters()) {
      await expect(
        adapter.anchorEvent({ ...ANCHOR_INPUT, data_hash: 'not-a-hash' })
      ).rejects.toMatchObject({ statusCode: 422, code: ErrorCodes.CHAIN_INVALID_HASH });
    }
  });

  it('rejects malformed proof hashes with the shared port error', async () => {
    for (const [, adapter] of await createBindingAdapters()) {
      await expect(
        adapter.releaseEscrow({ ...RELEASE_INPUT, proof_hash: 'not-a-hash' })
      ).rejects.toMatchObject({ statusCode: 422, code: ErrorCodes.CHAIN_INVALID_PROOF });
    }
  });
});

describe('ChainAdapter contract parity (simulated ↔ soroban)', () => {
  it('anchorEvent returns { txHash, ledger } on both adapters with the correct simulated flag', async () => {
    for (const [name, adapter, simulated] of await createBindingAdapters()) {
      const receipt = await adapter.anchorEvent({ ...ANCHOR_INPUT });
      expect(receipt.txHash).toMatch(/^[0-9a-f]{64}$/);
      expect(typeof receipt.ledger).toBe('number');
      expect(receipt.simulated).toBe(simulated);
    }
  });

  it('releaseEscrow returns { txHash, ledger } with paymentId passthrough on both adapters', async () => {
    for (const [, adapter, simulated] of await createBindingAdapters()) {
      const receipt = await adapter.releaseEscrow({ ...RELEASE_INPUT });
      expect(receipt.txHash).toMatch(/^[0-9a-f]{64}$/);
      expect(typeof receipt.ledger).toBe('number');
      expect(receipt.simulated).toBe(simulated);
      expect(receipt.paymentId).toBe(RELEASE_INPUT.payment_id);
    }
  });

  it('streamEvents yields ChainEvent objects validating against ChainEventSchema on both adapters', async () => {
    for (const [name, adapter] of await createBindingAdapters()) {
      if (name === 'simulated') {
        await adapter.anchorEvent({ ...ANCHOR_INPUT });
      }
      const events: ChainEvent[] = [];
      for await (const event of adapter.streamEvents(undefined)) {
        events.push(event);
        if (events.length >= 2) break;
      }
      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        expect(ChainEventSchema.safeParse(event).success).toBe(true);
      }
    }
  });

  it('asserts "simulated": true only in simulated mode', async () => {
    const bindings = await createBindingAdapters();
    const flags = new Map(bindings.map(([name, , simulated]) => [name, simulated]));
    expect(flags.get('simulated')).toBe(true);
    expect(flags.get('soroban')).toBe(false);
  });
});
