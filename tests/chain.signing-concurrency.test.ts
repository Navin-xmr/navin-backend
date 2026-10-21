/**
 * Load gate (TODO J4 / L4): concurrent anchor submissions from >1 worker against
 * one signing account must produce ZERO sequence failures.
 *
 * `SequencedHorizon` models Horizon's sequence rule — a tx is accepted only if
 * `tx.sequence === account.sequence + 1` — with randomized latency so unsafe
 * interleavings actually happen. The control test proves the harness detects races.
 */
import { describe, expect, it, jest } from '@jest/globals';
import {
  Account,
  BASE_FEE,
  Keypair,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import type { Transaction } from '@stellar/stellar-sdk';

import { KeyedSerializer } from '../src/services/chain/serializer.js';
import { SimulatedAdapter, isBadSequence } from '../src/services/chain/simulated.adapter.js';
import type { HorizonClient } from '../src/services/chain/simulated.adapter.js';
import { ErrorCodes } from '../src/shared/http/errors.js';
import { generateDataHash } from '../src/shared/utils/crypto.js';

const PASSPHRASE = Networks.TESTNET;
const WORKERS = 5; // matches stellar.worker concurrency
const JOBS_PER_WORKER = 20;

const jitter = () => new Promise<void>(r => setTimeout(r, Math.floor(Math.random() * 3)));

const badSeqError = () =>
  Object.assign(new Error('Transaction submission failed'), {
    response: { data: { extras: { result_codes: { transaction: 'tx_bad_seq' } } } },
  });

class SequencedHorizon implements HorizonClient {
  sequence = BigInt(5_000);
  ledger = 100;
  badSeqFailures = 0;
  readonly accepted: Transaction[] = [];
  /** Simulates another process using the same account: bump before the next N submits. */
  externalBumps = 0;

  loadAccount = jest.fn(async (publicKey: string) => {
    await jitter();
    return new Account(publicKey, this.sequence.toString());
  });

  submitTransaction = jest.fn(async (tx: Transaction) => {
    await jitter();
    if (this.externalBumps > 0) {
      this.externalBumps -= 1;
      this.sequence += BigInt(1);
    }
    if (BigInt(tx.sequence) !== this.sequence + BigInt(1)) {
      this.badSeqFailures += 1;
      throw badSeqError();
    }
    this.sequence += BigInt(1);
    this.accepted.push(tx);
    return { hash: tx.hash().toString('hex'), ledger: ++this.ledger };
  });

  listTransactions = jest.fn(async () => []);
}

const anchorInput = (worker: number, job: number, actor: string) => ({
  shipment_id: `ship_${worker}_${job}`,
  data_hash: generateDataHash({ worker, job }),
  actor,
});

describe('signing safety load gate', () => {
  it('control: unserialized concurrent submissions DO hit tx_bad_seq (harness detects races)', async () => {
    const horizon = new SequencedHorizon();
    const signer = Keypair.random();

    const naiveSubmit = async (i: number) => {
      const account = await horizon.loadAccount(signer.publicKey());
      const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
        .addOperation(Operation.manageData({ name: `n:${i}`, value: 'x' }))
        .addMemo(Memo.none())
        .setTimeout(30)
        .build();
      tx.sign(signer);
      return horizon.submitTransaction(tx);
    };

    const results = await Promise.allSettled(
      Array.from({ length: WORKERS * JOBS_PER_WORKER }, (_, i) => naiveSubmit(i))
    );
    expect(horizon.badSeqFailures).toBeGreaterThan(0);
    expect(results.some(r => r.status === 'rejected')).toBe(true);
  });

  it(`${WORKERS} workers × ${JOBS_PER_WORKER} concurrent anchors → zero sequence failures`, async () => {
    const horizon = new SequencedHorizon();
    const signer = Keypair.random();
    const start = horizon.sequence;

    // One adapter per worker, all signing with the same account (as N BullMQ workers would).
    const workers = Array.from(
      { length: WORKERS },
      () =>
        new SimulatedAdapter({ horizon, secretKey: signer.secret(), networkPassphrase: PASSPHRASE })
    );

    const results = await Promise.allSettled(
      workers.flatMap((adapter, w) =>
        Array.from({ length: JOBS_PER_WORKER }, (_, j) =>
          adapter.anchorEvent(anchorInput(w, j, signer.publicKey()))
        )
      )
    );

    const total = WORKERS * JOBS_PER_WORKER;
    expect(results.filter(r => r.status === 'rejected')).toEqual([]);
    expect(horizon.badSeqFailures).toBe(0);
    expect(horizon.accepted).toHaveLength(total);
    expect(horizon.sequence).toBe(start + BigInt(total));

    const sequences = horizon.accepted.map(tx => BigInt(tx.sequence));
    sequences.forEach((seq, i) => expect(seq).toBe(start + BigInt(i + 1)));

    const receipts = results.map(
      r => (r as PromiseFulfilledResult<{ txHash: string; simulated: boolean }>).value
    );
    expect(new Set(receipts.map(r => r.txHash)).size).toBe(total);
    expect(receipts.every(r => r.simulated)).toBe(true);
  }, 30_000);

  it('recovers from a tx_bad_seq caused by another process sharing the account', async () => {
    const horizon = new SequencedHorizon();
    const signer = Keypair.random();
    const adapter = new SimulatedAdapter({
      horizon,
      secretKey: signer.secret(),
      networkPassphrase: PASSPHRASE,
    });
    horizon.externalBumps = 1;

    const result = await adapter.anchorEvent(anchorInput(0, 0, signer.publicKey()));

    expect(result.simulated).toBe(true);
    expect(horizon.badSeqFailures).toBe(1);
    expect(horizon.loadAccount).toHaveBeenCalledTimes(2);
    expect(horizon.accepted).toHaveLength(1);
  });

  it('gives up after bounded retries with ERR_CHAIN_UNKNOWN', async () => {
    const horizon = new SequencedHorizon();
    const signer = Keypair.random();
    const adapter = new SimulatedAdapter({
      horizon,
      secretKey: signer.secret(),
      networkPassphrase: PASSPHRASE,
    });
    horizon.externalBumps = 10;

    await expect(adapter.anchorEvent(anchorInput(0, 0, signer.publicKey()))).rejects.toMatchObject({
      statusCode: 502,
      code: ErrorCodes.CHAIN_UNKNOWN,
    });
    expect(horizon.submitTransaction).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-sequence failures', async () => {
    const horizon = new SequencedHorizon();
    const signer = Keypair.random();
    const adapter = new SimulatedAdapter({
      horizon,
      secretKey: signer.secret(),
      networkPassphrase: PASSPHRASE,
    });
    horizon.submitTransaction.mockRejectedValueOnce(new Error('tx_insufficient_fee'));

    await expect(adapter.anchorEvent(anchorInput(0, 0, signer.publicKey()))).rejects.toMatchObject({
      code: ErrorCodes.CHAIN_UNKNOWN,
    });
    expect(horizon.submitTransaction).toHaveBeenCalledTimes(1);
  });

  it('isBadSequence recognises only Horizon tx_bad_seq responses', () => {
    expect(isBadSequence(badSeqError())).toBe(true);
    expect(isBadSequence(new Error('tx_bad_seq'))).toBe(false);
    expect(isBadSequence(null)).toBe(false);
  });
});

describe('KeyedSerializer', () => {
  it('runs same-key tasks one at a time in order, other keys in parallel', async () => {
    const serializer = new KeyedSerializer();
    const log: string[] = [];
    let running = 0;
    let maxSameKey = 0;

    const task = (key: string, id: number) =>
      serializer.run(key, async () => {
        if (key === 'a') maxSameKey = Math.max(maxSameKey, ++running);
        log.push(`${key}${id}:start`);
        await jitter();
        log.push(`${key}${id}:end`);
        if (key === 'a') running--;
        return id;
      });

    const results = await Promise.all([task('a', 1), task('a', 2), task('b', 1), task('a', 3)]);

    expect(results).toEqual([1, 2, 1, 3]);
    expect(maxSameKey).toBe(1);
    const aEvents = log.filter(e => e.startsWith('a'));
    expect(aEvents).toEqual(['a1:start', 'a1:end', 'a2:start', 'a2:end', 'a3:start', 'a3:end']);
    expect(log.indexOf('b1:start')).toBeLessThan(log.indexOf('a1:end'));
  });

  it('a failing task does not block the queue, and idle keys are released', async () => {
    const serializer = new KeyedSerializer();
    const failed = serializer.run('k', async () => {
      throw new Error('boom');
    });
    const next = serializer.run('k', async () => 'ok');

    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
    await new Promise(r => setImmediate(r));
    expect(serializer.activeKeys).toBe(0);
  });
});
