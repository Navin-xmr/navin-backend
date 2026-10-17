import { describe, expect, it, jest } from '@jest/globals';
import {
  Account,
  Keypair,
  Networks,
  SorobanDataBuilder,
  nativeToScVal,
  type Transaction,
  type rpc,
} from '@stellar/stellar-sdk';

import {
  SimulatedAdapter,
  type HorizonClient,
  type HorizonTxRecord,
} from '../src/services/chain/simulated.adapter.js';
import { SorobanAdapter } from '../src/services/chain/soroban.adapter.js';
import type { ChainAdapter } from '../src/services/chain/types.js';
import { ErrorCodes } from '../src/shared/http/errors.js';
import { CHAIN_EVENT_NAMES, ChainEventSchema, type ChainEvent } from '../src/shared/types/chain.js';

const signer = Keypair.random();
const CONTRACT_ID = 'CACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAINCW';
const SHIPMENT_ID = '65f1a2b3c4d5e6f708192a3b';
const PAYMENT_ID = '66a0b1c2d3e4f50617283940';
const DATA_HASH = 'a'.repeat(64);
const PROOF_HASH = 'b'.repeat(64);

function createSimulatedHarness(): ChainAdapter {
  const records: HorizonTxRecord[] = [];
  let ledger = 1000;

  const horizon: HorizonClient = {
    loadAccount: jest.fn(async (pk: string) => new Account(pk, '100')),
    submitTransaction: jest.fn(async (tx: Transaction) => {
      ledger += 1;
      const hash = tx.hash().toString('hex');
      records.push({
        paging_token: String(ledger * 4096),
        hash,
        ledger_attr: ledger,
        created_at: new Date(Date.UTC(2026, 8, 27, 10, 0, ledger - 1000)).toISOString(),
        envelope_xdr: tx.toEnvelope().toXDR('base64'),
        successful: true,
      });
      return { hash, ledger };
    }),
    listTransactions: jest.fn(async (_pk: string, cursor: string | undefined, limit: number) => {
      const start = cursor ? records.findIndex(r => r.paging_token === cursor) + 1 : 0;
      return records.slice(start, start + limit);
    }),
  };

  return new SimulatedAdapter({
    horizon,
    secretKey: signer.secret(),
    networkPassphrase: Networks.TESTNET,
  });
}

function createSorobanHarness(): ChainAdapter {
  let ledger = 1000;
  let lastHash = 'c'.repeat(64);
  const emittedEvents: Array<{
    id: string;
    contractId: string;
    txHash: string;
    ledger: number;
    ledgerClosedAt: string;
    topic: [string, string];
    value: [string, number];
  }> = [];

  const rpcServer = {
    getAccount: jest.fn(async (pk: string) => new Account(pk, '100')),
    simulateTransaction: jest.fn(async () => ({
      id: 'sim-1',
      latestLedger: ledger,
      events: [],
      transactionData: new SorobanDataBuilder(),
      minResourceFee: '100',
      result: { auth: [], retval: nativeToScVal(null) },
      _parsed: true,
    })),
    sendTransaction: jest.fn(async (tx: Transaction) => {
      ledger += 1;
      lastHash = tx.hash().toString('hex');
      emittedEvents.push({
        id: String(ledger * 4096),
        contractId: CONTRACT_ID,
        txHash: lastHash,
        ledger,
        ledgerClosedAt: new Date(Date.UTC(2026, 8, 27, 10, 0, ledger - 1000)).toISOString(),
        topic: [CHAIN_EVENT_NAMES.ANCHOR, SHIPMENT_ID],
        value: [DATA_HASH, ledger],
      });
      return { status: 'PENDING', hash: lastHash };
    }),
    getTransaction: jest.fn(async () => ({
      status: 'SUCCESS',
      ledger,
    })),
    getEvents: jest.fn(async () => ({
      events: emittedEvents,
    })),
  } as unknown as rpc.Server;

  return new SorobanAdapter({
    rpcServer,
    contractId: CONTRACT_ID,
    secretKey: signer.secret(),
    networkPassphrase: Networks.TESTNET,
  });
}

const adapterBindings: Array<[string, boolean, () => ChainAdapter]> = [
  ['simulated', true, createSimulatedHarness],
  ['soroban', false, createSorobanHarness],
];

describe.each(adapterBindings)(
  '%s ChainAdapter contract (simulated=%s)',
  (_binding, expectedSimulated, createAdapter) => {
    it('rejects malformed anchor hashes with the shared port error', async () => {
      await expect(
        createAdapter().anchorEvent({
          shipment_id: SHIPMENT_ID,
          data_hash: 'not-a-hash',
          actor: signer.publicKey(),
        })
      ).rejects.toMatchObject({ statusCode: 422, code: ErrorCodes.CHAIN_INVALID_HASH });
    });

    it('rejects malformed proof hashes with the shared port error', async () => {
      await expect(
        createAdapter().releaseEscrow({ payment_id: PAYMENT_ID, proof_hash: 'not-a-hash' })
      ).rejects.toMatchObject({ statusCode: 422, code: ErrorCodes.CHAIN_INVALID_PROOF });
    });

    it('anchors a valid payload hash and returns a normalized receipt with matching simulated flag', async () => {
      const adapter = createAdapter();
      const result = await adapter.anchorEvent({
        shipment_id: SHIPMENT_ID,
        data_hash: DATA_HASH,
        actor: signer.publicKey(),
      });

      expect(result).toEqual({
        txHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        ledger: 1001,
        simulated: expectedSimulated,
      });
    });

    it('releases escrow with a valid proof hash and echoes paymentId with matching simulated flag', async () => {
      const adapter = createAdapter();
      const result = await adapter.releaseEscrow({
        payment_id: PAYMENT_ID,
        proof_hash: PROOF_HASH,
      });

      expect(result).toEqual({
        txHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        ledger: 1001,
        simulated: expectedSimulated,
        paymentId: PAYMENT_ID,
      });
    });

    it('streams spec-valid anchor events after anchorEvent invocation', async () => {
      const adapter = createAdapter();
      const receipt = await adapter.anchorEvent({
        shipment_id: SHIPMENT_ID,
        data_hash: DATA_HASH,
        actor: signer.publicKey(),
      });

      const events: ChainEvent[] = [];
      for await (const ev of adapter.streamEvents()) {
        events.push(ev);
      }

      expect(events).toHaveLength(1);
      expect(ChainEventSchema.safeParse(events[0]).success).toBe(true);
      expect(events[0]).toMatchObject({
        tx_hash: receipt.txHash,
        ledger: receipt.ledger,
        name: CHAIN_EVENT_NAMES.ANCHOR,
        topic: [CHAIN_EVENT_NAMES.ANCHOR, SHIPMENT_ID],
        data: [DATA_HASH, receipt.ledger],
      });
    });
  }
);