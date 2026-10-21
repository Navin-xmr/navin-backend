import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Account, Keypair, Networks, StrKey } from '@stellar/stellar-sdk';
import type { Transaction } from '@stellar/stellar-sdk';

import {
  SIMULATED_CONTRACT_ID,
  SimulatedAdapter,
  toTokenizeAnchorInput,
} from '../src/services/chain/simulated.adapter.js';
import type { HorizonClient, HorizonTxRecord } from '../src/services/chain/simulated.adapter.js';
import { AppError, ErrorCodes } from '../src/shared/http/errors.js';
import { ChainEventSchema } from '../src/shared/types/chain.js';
import type { ChainEvent } from '../src/shared/types/chain.js';
import { generateDataHash } from '../src/shared/utils/crypto.js';

const signer = Keypair.random();
const PASSPHRASE = Networks.TESTNET;
const SHIPMENT_ID = '65f1a2b3c4d5e6f708192a3b';
const PAYMENT_ID = '66a0b1c2d3e4f50617283940';
const HASH_A = generateDataHash({ reading: 'a' });
const HASH_B = generateDataHash({ reading: 'b' });

/** In-memory Horizon: records every submitted tx so streamEvents can replay it. */
function createFakeHorizon() {
  const submitted: Transaction[] = [];
  const records: HorizonTxRecord[] = [];
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
  } satisfies HorizonClient;

  return { client, submitted, records };
}

const collect = async (it: AsyncIterable<ChainEvent>) => {
  const out: ChainEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
};

const manageDataOps = (tx: Transaction) =>
  tx.operations.map(op => {
    if (op.type !== 'manageData') throw new Error(`unexpected op ${op.type}`);
    return { name: op.name, value: op.value?.toString('utf8') };
  });

describe('SimulatedAdapter', () => {
  let horizon: ReturnType<typeof createFakeHorizon>;
  let adapter: SimulatedAdapter;

  beforeEach(() => {
    horizon = createFakeHorizon();
    adapter = new SimulatedAdapter({
      horizon: horizon.client,
      secretKey: signer.secret(),
      networkPassphrase: PASSPHRASE,
    });
  });

  describe('anchorEvent (legacy anchorTelemetryHash flow)', () => {
    it('submits the same manage-data + hash memo and flags the result simulated', async () => {
      const result = await adapter.anchorEvent({
        shipment_id: SHIPMENT_ID,
        data_hash: HASH_A,
        actor: signer.publicKey(),
      });

      const [tx] = horizon.submitted;
      expect(manageDataOps(tx!)).toEqual([{ name: `telemetry:${SHIPMENT_ID}`, value: HASH_A }]);
      expect(tx!.memo.type).toBe('hash');
      expect((tx!.memo.value as Buffer).toString('hex')).toBe(HASH_A);
      expect(tx!.source).toBe(signer.publicKey());
      expect(tx!.signatures).toHaveLength(1);
      expect(tx!.timeBounds?.maxTime).not.toBe('0');
      expect(result).toEqual({ txHash: tx!.hash().toString('hex'), ledger: 1001, simulated: true });
    });

    it('rejects a malformed data_hash with ERR_CHAIN_INVALID_HASH before touching Horizon', async () => {
      await expect(
        adapter.anchorEvent({
          shipment_id: SHIPMENT_ID,
          data_hash: 'nothex',
          actor: signer.publicKey(),
        })
      ).rejects.toMatchObject({ statusCode: 422, code: ErrorCodes.CHAIN_INVALID_HASH });
      expect(horizon.client.loadAccount).not.toHaveBeenCalled();
    });
  });

  describe('tokenize → anchorEvent mapping', () => {
    const shipment = {
      shipmentId: SHIPMENT_ID,
      trackingNumber: 'NVN-123456',
      origin: 'Lagos',
      destination: 'Accra',
    };

    it('anchors a deterministic hash of the tokenized fields', async () => {
      const input = toTokenizeAnchorInput(shipment, signer.publicKey());
      expect(input).toEqual({
        shipment_id: SHIPMENT_ID,
        data_hash: generateDataHash(shipment),
        actor: signer.publicKey(),
      });
      expect(toTokenizeAnchorInput({ ...shipment }, signer.publicKey())).toEqual(input);

      const result = await adapter.anchorEvent(input);
      expect(result.simulated).toBe(true);
      expect(manageDataOps(horizon.submitted[0]!)).toEqual([
        { name: `telemetry:${SHIPMENT_ID}`, value: input.data_hash },
      ]);
    });
  });

  describe('releaseEscrow (legacy releaseEscrow flow)', () => {
    it('records the release via manage-data and returns a simulated receipt', async () => {
      const result = await adapter.releaseEscrow({ payment_id: PAYMENT_ID, proof_hash: HASH_B });

      const [tx] = horizon.submitted;
      expect(manageDataOps(tx!)).toEqual([{ name: `release:${PAYMENT_ID}`, value: HASH_B }]);
      expect(tx!.memo.type).toBe('hash');
      expect(result).toEqual({
        txHash: tx!.hash().toString('hex'),
        ledger: 1001,
        simulated: true,
        paymentId: PAYMENT_ID,
      });
    });

    it('rejects with AppError(502, ERR_CHAIN_UNKNOWN) instead of resolving { success: false }', async () => {
      horizon.client.submitTransaction.mockRejectedValueOnce(new Error('tx_bad_seq'));
      const promise = adapter.releaseEscrow({ payment_id: PAYMENT_ID, proof_hash: HASH_B });
      await expect(promise).rejects.toBeInstanceOf(AppError);
      await expect(promise).rejects.toMatchObject({
        statusCode: 502,
        code: ErrorCodes.CHAIN_UNKNOWN,
        details: { cause: 'tx_bad_seq' },
      });
    });

    it('rejects a malformed proof_hash with ERR_CHAIN_INVALID_PROOF', async () => {
      await expect(
        adapter.releaseEscrow({ payment_id: PAYMENT_ID, proof_hash: HASH_B.toUpperCase() })
      ).rejects.toMatchObject({ statusCode: 422, code: ErrorCodes.CHAIN_INVALID_PROOF });
    });
  });

  it('rejects every method with ERR_CHAIN_UNKNOWN when the signer key is missing', async () => {
    const unconfigured = new SimulatedAdapter({
      horizon: horizon.client,
      secretKey: '',
      networkPassphrase: PASSPHRASE,
    });
    const expected = { statusCode: 500, code: ErrorCodes.CHAIN_UNKNOWN };
    await expect(
      unconfigured.anchorEvent({
        shipment_id: SHIPMENT_ID,
        data_hash: HASH_A,
        actor: signer.publicKey(),
      })
    ).rejects.toMatchObject(expected);
    await expect(
      unconfigured.releaseEscrow({ payment_id: PAYMENT_ID, proof_hash: HASH_B })
    ).rejects.toMatchObject(expected);
    await expect(collect(unconfigured.streamEvents())).rejects.toMatchObject(expected);
  });

  describe('streamEvents', () => {
    beforeEach(async () => {
      await adapter.anchorEvent({
        shipment_id: SHIPMENT_ID,
        data_hash: HASH_A,
        actor: signer.publicKey(),
      });
      await adapter.releaseEscrow({ payment_id: PAYMENT_ID, proof_hash: HASH_B });
      await adapter.anchorEvent({
        shipment_id: 'ship_2',
        data_hash: HASH_B,
        actor: signer.publicKey(),
      });
    });

    it('replays anchor writes as spec-valid anchor events (releases are not fabricated)', async () => {
      const events = await collect(adapter.streamEvents());

      expect(events.map(e => e.topic)).toEqual([
        ['anchor', SHIPMENT_ID],
        ['anchor', 'ship_2'],
      ]);
      for (const e of events) expect(ChainEventSchema.safeParse(e).success).toBe(true);
      expect(events[0]).toMatchObject({
        id: horizon.records[0]!.paging_token,
        contract_id: SIMULATED_CONTRACT_ID,
        tx_hash: horizon.records[0]!.hash,
        ledger: 1001,
        data: [HASH_A, 1001],
      });
    });

    it('resumes strictly after the cursor', async () => {
      const [first] = await collect(adapter.streamEvents());
      const resumed = await collect(adapter.streamEvents(first!.id));
      expect(resumed.map(e => e.topic[1])).toEqual(['ship_2']);
      expect(horizon.client.listTransactions).toHaveBeenLastCalledWith(
        signer.publicKey(),
        first!.id,
        200
      );
    });

    it('skips failed transactions', async () => {
      horizon.records[0]!.successful = false;
      const events = await collect(adapter.streamEvents());
      expect(events.map(e => e.topic[1])).toEqual(['ship_2']);
    });

    it('pages through Horizon until a short page', async () => {
      const template = horizon.records[0]!;
      horizon.records.length = 0;
      for (let i = 0; i < 250; i++) {
        horizon.records.push({ ...template, paging_token: String(10_000 + i) });
      }
      const events = await collect(adapter.streamEvents());
      expect(events).toHaveLength(250);
      expect(horizon.client.listTransactions).toHaveBeenCalledTimes(2);
    });

    it('wraps Horizon read failures as ERR_CHAIN_UNKNOWN', async () => {
      horizon.client.listTransactions.mockRejectedValueOnce(new Error('503'));
      await expect(collect(adapter.streamEvents())).rejects.toMatchObject({
        statusCode: 502,
        code: ErrorCodes.CHAIN_UNKNOWN,
      });
    });
  });

  it('uses the all-zero contract strkey as the simulated contract id', () => {
    expect(StrKey.isValidContract(SIMULATED_CONTRACT_ID)).toBe(true);
    expect(StrKey.decodeContract(SIMULATED_CONTRACT_ID).equals(Buffer.alloc(32))).toBe(true);
  });
});
