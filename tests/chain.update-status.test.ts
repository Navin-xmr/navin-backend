import { describe, expect, it, jest } from '@jest/globals';
import {
  Account,
  Keypair,
  Networks,
  SorobanDataBuilder,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import type { Transaction } from '@stellar/stellar-sdk';

import { SorobanAdapter } from '../src/services/chain/soroban.adapter.js';
import { SimulatedAdapter } from '../src/services/chain/simulated.adapter.js';
import { AppError, ErrorCodes } from '../src/shared/http/errors.js';
import {
  SHIPMENT_STATUSES,
  UPDATE_STATUS_CONTRACT_ERRORS,
  UpdateStatusArgsSchema,
  updateStatusErrorToAppError,
} from '../src/shared/types/chain.js';
import type { UpdateStatusInput } from '../src/services/chain/types.js';

const KEYPAIR = Keypair.random();
const CALLER = KEYPAIR.publicKey();
const CONTRACT_ID = 'CACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAINCW';
// A hash the adapter must never recompute: it is NOT sha256 of anything meaningful.
const DATA_HASH = 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb';
const TX_HASH = 'e'.repeat(64);

const input = (over: Partial<UpdateStatusInput> = {}): UpdateStatusInput => ({
  caller: CALLER,
  shipment_id: '42',
  new_status: 'InTransit',
  data_hash: DATA_HASH,
  ...over,
});

type FakeServer = {
  getAccount: jest.Mock<(k: string) => Promise<Account>>;
  simulateTransaction: jest.Mock<(tx: Transaction) => Promise<unknown>>;
  sendTransaction: jest.Mock<(tx: Transaction) => Promise<unknown>>;
  getTransaction: jest.Mock<(h: string) => Promise<unknown>>;
};

function successfulSimulation() {
  return {
    id: '1',
    latestLedger: 10,
    events: [],
    _parsed: true,
    transactionData: new SorobanDataBuilder(),
    minResourceFee: '100',
    result: { auth: [], retval: xdr.ScVal.scvVoid() },
  };
}

function fakeServer(simulate: () => Promise<unknown>): FakeServer {
  return {
    getAccount: jest.fn(async () => new Account(CALLER, '100')),
    simulateTransaction: jest.fn(async () => simulate()),
    sendTransaction: jest.fn(async () => ({ status: 'PENDING', hash: TX_HASH })),
    getTransaction: jest.fn(async () => ({ status: 'SUCCESS', ledger: 777 })),
  };
}

function adapterWith(server: FakeServer): SorobanAdapter {
  return new SorobanAdapter({
    secretKey: KEYPAIR.secret(),
    contractId: CONTRACT_ID,
    networkPassphrase: Networks.TESTNET,
    rpcServer: server as unknown as ConstructorParameters<typeof SorobanAdapter>[0] extends infer O
      ? O extends { rpcServer?: infer S }
        ? S
        : never
      : never,
  });
}

/** Decode the single invokeHostFunction op the adapter simulated. */
function simulatedArgs(server: FakeServer): { fn: string; args: xdr.ScVal[] } {
  const tx = server.simulateTransaction.mock.calls[0]![0];
  const op = tx.operations[0] as unknown as { func: xdr.HostFunction };
  const invoke = op.func.invokeContract();
  return { fn: invoke.functionName().toString(), args: invoke.args() };
}

describe('SorobanAdapter.updateStatus — ABI encoding (#1047)', () => {
  it('ShipmentStatus variants match the contract declaration order', () => {
    expect([...SHIPMENT_STATUSES]).toEqual([
      'Created',
      'InTransit',
      'AtCheckpoint',
      'PartiallyDelivered',
      'Delivered',
      'Disputed',
      'Cancelled',
      'PartiallyRefunded',
    ]);
  });

  it.each(SHIPMENT_STATUSES.map(s => [s] as const))(
    'encodes %s as ScVal vec[Symbol] and returns a confirmed receipt',
    async status => {
      const server = fakeServer(async () => successfulSimulation());
      const result = await adapterWith(server).updateStatus(input({ new_status: status }));

      expect(result).toEqual({
        txHash: TX_HASH,
        ledger: 777,
        simulated: false,
        shipmentId: '42',
        newStatus: status,
      });

      const { fn, args } = simulatedArgs(server);
      expect(fn).toBe('update_status');
      expect(args).toHaveLength(4);
      // caller: Address
      expect(scValToNative(args[0]!)).toBe(CALLER);
      // shipment_id: u64
      expect(args[1]!.switch().name).toBe('scvU64');
      expect(scValToNative(args[1]!)).toBe(BigInt(42));
      // new_status: unit-variant contracttype enum => vec [Symbol(name)]
      expect(args[2]!.switch().name).toBe('scvVec');
      const variant = args[2]!.vec()!;
      expect(variant).toHaveLength(1);
      expect(variant[0]!.switch().name).toBe('scvSymbol');
      expect(variant[0]!.sym().toString()).toBe(status);
      // data_hash: BytesN<32>
      expect(args[3]!.switch().name).toBe('scvBytes');
      expect(args[3]!.bytes().length).toBe(32);
    }
  );

  it('passes data_hash through byte-for-byte (adapter never recomputes it)', async () => {
    const server = fakeServer(async () => successfulSimulation());
    await adapterWith(server).updateStatus(input());
    const { args } = simulatedArgs(server);
    expect(Buffer.from(args[3]!.bytes()).toString('hex')).toBe(DATA_HASH);
  });

  it('encodes the u64 upper bound', async () => {
    const max = '18446744073709551615';
    const server = fakeServer(async () => successfulSimulation());
    await adapterWith(server).updateStatus(input({ shipment_id: max }));
    expect(scValToNative(simulatedArgs(server).args[1]!)).toBe(BigInt(max));
  });

  it('signs and submits through the standard pipeline (simulate → send → poll)', async () => {
    const server = fakeServer(async () => successfulSimulation());
    await adapterWith(server).updateStatus(input());
    expect(server.simulateTransaction).toHaveBeenCalledTimes(1);
    expect(server.sendTransaction).toHaveBeenCalledTimes(1);
    expect(server.sendTransaction.mock.calls[0]![0].signatures).toHaveLength(1);
    expect(server.getTransaction).toHaveBeenCalledWith(TX_HASH);
  });

  it.each([
    ['unknown status', { new_status: 'Teleported' }],
    ['lowercase status', { new_status: 'intransit' }],
    ['non-numeric shipment id', { shipment_id: 'ship-1' }],
    ['u64 overflow', { shipment_id: '18446744073709551616' }],
    ['leading-zero shipment id', { shipment_id: '007' }],
    ['bad caller', { caller: 'not-an-address' }],
  ])('rejects %s before any RPC call', async (_label, bad) => {
    const server = fakeServer(async () => successfulSimulation());
    await expect(
      adapterWith(server).updateStatus({ ...input(), ...bad } as UpdateStatusInput)
    ).rejects.toBeInstanceOf(AppError);
    expect(server.getAccount).not.toHaveBeenCalled();
    expect(server.simulateTransaction).not.toHaveBeenCalled();
  });

  it('rejects a malformed data_hash with ERR_CHAIN_INVALID_HASH before any RPC call', async () => {
    const server = fakeServer(async () => successfulSimulation());
    await expect(
      adapterWith(server).updateStatus(input({ data_hash: 'ABCD' }))
    ).rejects.toMatchObject({ code: ErrorCodes.CHAIN_INVALID_HASH, statusCode: 422 });
    expect(server.simulateTransaction).not.toHaveBeenCalled();
  });
});

describe('SorobanAdapter.updateStatus — error mapping (#1047)', () => {
  const failWith = (code: number) =>
    fakeServer(async () => ({
      id: '1',
      latestLedger: 1,
      error: `HostError: Error(Contract, #${code})`,
    }));

  it('maps contract InvalidStatus (5) — an invalid transition — to ERR_CHAIN_INVALID_STATUS', async () => {
    const server = failWith(5);
    await expect(adapterWith(server).updateStatus(input())).rejects.toMatchObject({
      code: ErrorCodes.CHAIN_INVALID_STATUS,
      statusCode: 409,
      details: { contractCode: 5, function: 'update_status' },
    });
    expect(server.sendTransaction).not.toHaveBeenCalled();
  });

  it('maps contract DuplicateAction (41) to ERR_CHAIN_DUPLICATE_ACTION', async () => {
    await expect(adapterWith(failWith(41)).updateStatus(input())).rejects.toMatchObject({
      code: ErrorCodes.CHAIN_DUPLICATE_ACTION,
      statusCode: 409,
    });
  });

  it.each([
    [3, ErrorCodes.CHAIN_UNAUTHORIZED, 403],
    [4, ErrorCodes.CHAIN_SHIPMENT_NOT_FOUND, 404],
    [6, ErrorCodes.CHAIN_INVALID_HASH, 422],
    [38, ErrorCodes.CHAIN_INVALID_STATUS, 409],
  ])('maps contract error %i to %s', async (code, expected, status) => {
    await expect(adapterWith(failWith(code)).updateStatus(input())).rejects.toMatchObject({
      code: expected,
      statusCode: status,
    });
  });

  it('does not use the legacy table: code 9 is not InvalidStatus for update_status', async () => {
    // Legacy table: 9 = InvalidStatus. Real contract: 9 = ShipmentAlreadyCompleted (unmapped here).
    await expect(adapterWith(failWith(9)).updateStatus(input())).rejects.toMatchObject({
      code: ErrorCodes.CHAIN_UNKNOWN,
      details: { contractCode: 9, function: 'update_status' },
    });
  });

  it('keeps the raw contract code for unmapped errors', () => {
    const err = updateStatusErrorToAppError(21);
    expect(err.code).toBe(ErrorCodes.CHAIN_UNKNOWN);
    expect(err.details).toEqual({ contractCode: 21, function: 'update_status' });
  });

  it('covers every code in the update_status error table', () => {
    for (const code of Object.values(UPDATE_STATUS_CONTRACT_ERRORS)) {
      expect(updateStatusErrorToAppError(code).code).not.toBe(ErrorCodes.CHAIN_UNKNOWN);
    }
  });

  it('a duplicate submit surfaces DuplicateAction on the second call only', async () => {
    let calls = 0;
    const server = fakeServer(async () =>
      ++calls === 1
        ? successfulSimulation()
        : { id: '1', latestLedger: 1, error: 'Error(Contract, #41)' }
    );
    const adapter = adapterWith(server);
    await expect(adapter.updateStatus(input())).resolves.toMatchObject({ txHash: TX_HASH });
    await expect(adapter.updateStatus(input())).rejects.toMatchObject({
      code: ErrorCodes.CHAIN_DUPLICATE_ACTION,
    });
  });
});

describe('UpdateStatusArgsSchema', () => {
  it('is strict', () => {
    expect(UpdateStatusArgsSchema.safeParse({ ...input(), extra: 1 }).success).toBe(false);
  });
});

describe('SimulatedAdapter.updateStatus', () => {
  it('writes the supplied data_hash verbatim and flags the receipt simulated', async () => {
    const submitted: Transaction[] = [];
    const adapter = new SimulatedAdapter({
      secretKey: KEYPAIR.secret(),
      networkPassphrase: Networks.TESTNET,
      horizon: {
        loadAccount: async () => new Account(CALLER, '1'),
        submitTransaction: async tx => {
          submitted.push(tx);
          return { hash: TX_HASH, ledger: 9 };
        },
        listTransactions: async () => [],
      },
    });
    const result = await adapter.updateStatus(input({ new_status: 'Delivered' }));
    expect(result).toMatchObject({ simulated: true, shipmentId: '42', newStatus: 'Delivered' });
    const op = submitted[0]!.operations[0] as unknown as { name: string; value: Buffer };
    expect(op.name).toBe('status:42:Delivered');
    expect(op.value.toString('utf8')).toBe(DATA_HASH);
  });

  it('rejects an invalid status without submitting', async () => {
    const adapter = new SimulatedAdapter({
      secretKey: KEYPAIR.secret(),
      horizon: {
        loadAccount: jest.fn<() => Promise<Account>>(),
        submitTransaction: jest.fn<() => Promise<{ hash: string; ledger: number }>>(),
        listTransactions: async () => [],
      },
    });
    await expect(
      adapter.updateStatus({ ...input(), new_status: 'Nope' } as unknown as UpdateStatusInput)
    ).rejects.toBeInstanceOf(AppError);
  });
});
