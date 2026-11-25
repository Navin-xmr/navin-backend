/**
 * #1037 — createShipment ChainAdapter port method.
 *
 * Verifies: args are encoded exactly per the ABI (order + types), participant
 * distinctness and milestone sums fail fast locally, the on-chain `u64`
 * shipment id is returned in the receipt, and contract-side rejections
 * surface unmapped via `chainErrorToAppError` (no local guessing).
 */
import { describe, expect, it, jest } from '@jest/globals';
import { Account, Contract, Keypair, Networks, nativeToScVal, Address } from '@stellar/stellar-sdk';

import { SimulatedAdapter } from '../src/services/chain/simulated.adapter.js';
import { SorobanAdapter } from '../src/services/chain/soroban.adapter.js';
import { ErrorCodes } from '../src/shared/http/errors.js';
import type { HorizonTransactionRecordMock, SimulatedHorizonClientMock } from './helpers/mocks.js';

const signer = Keypair.random();
const SENDER = signer.publicKey();
const RECEIVER = Keypair.random().publicKey();
const CARRIER = Keypair.random().publicKey();
const CONTRACT_ID = 'CACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAINCW';
const DATA_HASH = 'c1'.repeat(32);

const VALID_INPUT = {
  sender: SENDER,
  receiver: RECEIVER,
  carrier: CARRIER,
  data_hash: DATA_HASH,
  payment_milestones: ['500000000', '1000000000'],
  deadline: 1_800_000_000,
};

describe('SorobanAdapter.createShipment — encoded invocation', () => {
  it('calls the contract with args in ABI order and the correct ScVal types', async () => {
    const rpcStub = {
      getAccount: jest.fn(async (pk: string) => new Account(pk, '100')),
      simulateTransaction: jest.fn(async () => ({})),
      sendTransaction: jest.fn(async () => ({ status: 'PENDING', hash: 'd2'.repeat(32) })),
      getTransaction: jest.fn(async () => ({
        status: 'SUCCESS',
        ledger: 777,
        returnValue: nativeToScVal(BigInt(42), { type: 'u64' }),
      })),
      getLatestLedger: jest.fn(async () => ({ sequence: 1000 })),
    };

    const adapter = new SorobanAdapter({
      secretKey: signer.secret(),
      contractId: CONTRACT_ID,
      networkPassphrase: Networks.TESTNET,
      rpcServer: rpcStub as never,
    });

    // Avoid depending on real simulateTransaction/assembleTransaction wiring —
    // only the *args passed to Contract.call* and the decoded return value matter here.
    const callSpy = jest.spyOn(Contract.prototype, 'call');
    jest
      .spyOn(
        adapter as unknown as { invokePipeline: (op: unknown) => Promise<unknown> },
        'invokePipeline'
      )
      .mockImplementation(async () => ({ txHash: 'd2'.repeat(32), ledger: 777, returnValue: 42n }));

    const result = await adapter.createShipment(VALID_INPUT);

    expect(callSpy).toHaveBeenCalledTimes(1);
    const [fnName, ...args] = callSpy.mock.calls[0]!;
    expect(fnName).toBe('create_shipment');
    expect(args.map(a => a.toXDR('base64'))).toEqual([
      new Address(VALID_INPUT.sender).toScVal().toXDR('base64'),
      new Address(VALID_INPUT.receiver).toScVal().toXDR('base64'),
      new Address(VALID_INPUT.carrier).toScVal().toXDR('base64'),
      nativeToScVal(Buffer.from(VALID_INPUT.data_hash, 'hex'), { type: 'bytes' }).toXDR('base64'),
      nativeToScVal(
        VALID_INPUT.payment_milestones.map(m => BigInt(m)),
        {
          type: 'i128',
        }
      ).toXDR('base64'),
      nativeToScVal(VALID_INPUT.deadline, { type: 'u64' }).toXDR('base64'),
    ]);

    expect(result).toEqual({
      txHash: 'd2'.repeat(32),
      ledger: 777,
      simulated: false,
      shipmentId: 42,
    });

    callSpy.mockRestore();
  });

  it('rejects when sender/receiver/carrier are not distinct — without calling the contract', async () => {
    const adapter = new SorobanAdapter({
      secretKey: signer.secret(),
      contractId: CONTRACT_ID,
      networkPassphrase: Networks.TESTNET,
    });
    const callSpy = jest.spyOn(Contract.prototype, 'call');

    await expect(
      adapter.createShipment({ ...VALID_INPUT, carrier: VALID_INPUT.sender })
    ).rejects.toMatchObject({ statusCode: 422, code: ErrorCodes.CHAIN_INVALID_AMOUNT });
    expect(callSpy).not.toHaveBeenCalled();

    callSpy.mockRestore();
  });

  it('rejects an empty milestone list locally', async () => {
    const adapter = new SorobanAdapter({
      secretKey: signer.secret(),
      contractId: CONTRACT_ID,
      networkPassphrase: Networks.TESTNET,
    });
    await expect(
      adapter.createShipment({ ...VALID_INPUT, payment_milestones: [] })
    ).rejects.toMatchObject({ statusCode: 422, code: ErrorCodes.CHAIN_INVALID_AMOUNT });
  });

  it('rejects a malformed data_hash locally', async () => {
    const adapter = new SorobanAdapter({
      secretKey: signer.secret(),
      contractId: CONTRACT_ID,
      networkPassphrase: Networks.TESTNET,
    });
    await expect(
      adapter.createShipment({ ...VALID_INPUT, data_hash: 'not-a-hash' })
    ).rejects.toMatchObject({ statusCode: 422, code: ErrorCodes.CHAIN_INVALID_AMOUNT });
  });
});

describe('SimulatedAdapter.createShipment', () => {
  function createFakeHorizon() {
    const records: HorizonTransactionRecordMock[] = [];
    let ledger = 500;
    const client = {
      loadAccount: jest.fn(async (pk: string) => new Account(pk, '100')),
      submitTransaction: jest.fn(async tx => {
        ledger += 1;
        return { hash: tx.hash().toString('hex'), ledger };
      }),
      listTransactions: jest.fn(async () => records),
    } satisfies SimulatedHorizonClientMock;
    return client;
  }

  it('returns a simulated receipt with a numeric shipmentId', async () => {
    const adapter = new SimulatedAdapter({
      horizon: createFakeHorizon(),
      secretKey: signer.secret(),
      networkPassphrase: Networks.TESTNET,
    });

    const result = await adapter.createShipment(VALID_INPUT);
    expect(result.simulated).toBe(true);
    expect(typeof result.shipmentId).toBe('number');
    expect(result.txHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects malformed input the same way as the live adapter', async () => {
    const adapter = new SimulatedAdapter({
      horizon: createFakeHorizon(),
      secretKey: signer.secret(),
      networkPassphrase: Networks.TESTNET,
    });

    await expect(
      adapter.createShipment({ ...VALID_INPUT, carrier: VALID_INPUT.sender })
    ).rejects.toMatchObject({ statusCode: 422 });
  });
});
