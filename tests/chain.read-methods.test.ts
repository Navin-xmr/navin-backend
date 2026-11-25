/**
 * SorobanAdapter contract reads (P12-14): simulation-only invocation, ScVal
 * decoding (Option / enum / struct), not-found handling, and the startup
 * readiness check. The RPC server is a fake, so nothing touches the network.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { Address, contract, Keypair, nativeToScVal, Networks, xdr } from '@stellar/stellar-sdk';
import type { rpc, Transaction } from '@stellar/stellar-sdk';

import { decodeOption, decodeShipmentStatus, decodeU32 } from '../src/services/chain/decoders.js';
import { checkChainReadiness } from '../src/services/chain/readiness.js';
import { SorobanAdapter } from '../src/services/chain/soroban.adapter.js';
import type { ChainAdapter } from '../src/services/chain/types.js';
import { ErrorCodes } from '../src/shared/http/errors.js';

const CONTRACT_ID = 'CACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAINCW';
const ADMIN = Keypair.random().publicKey();
const SHIPMENT_ID = 42n;

type SimResponse = Record<string, unknown>;

const success = (retval: xdr.ScVal): SimResponse => ({
  transactionData: {},
  minResourceFee: '100',
  result: { auth: [], retval },
  latestLedger: 1,
  events: [],
  _parsed: true,
});
const contractError = (code: number): SimResponse => ({
  error: `HostError: Error(Contract, #${code})`,
  latestLedger: 1,
  events: [],
  _parsed: true,
});

function setup(response: SimResponse | Error) {
  const simulateTransaction = jest.fn(async (_tx: Transaction) => {
    if (response instanceof Error) throw response;
    return response;
  });
  const server = {
    simulateTransaction,
    sendTransaction: jest.fn(),
    getAccount: jest.fn(),
    getTransaction: jest.fn(),
  };
  const adapter = new SorobanAdapter({
    contractId: CONTRACT_ID,
    networkPassphrase: Networks.TESTNET,
    rpcServer: server as unknown as rpc.Server,
    // No secretKey: reads must not need one.
  });
  return { adapter, server, simulateTransaction };
}

/** Function name and args of the single invokeContract op in a simulated tx. */
function invocation(tx: Transaction) {
  const fn = tx
    .toEnvelope()
    .v1()
    .tx()
    .operations()[0]!
    .body()
    .invokeHostFunctionOp()
    .hostFunction();
  const call = fn.invokeContract();
  return { name: call.functionName().toString(), args: call.args() };
}

const sym = (s: string) => xdr.ScVal.scvSymbol(s);
const entry = (key: string, val: xdr.ScVal) => new xdr.ScMapEntry({ key: sym(key), val });

describe('SorobanAdapter reads never submit a transaction', () => {
  it.each([
    ['getVersion', () => xdr.ScVal.scvU32(3)],
    ['getAdmin', () => new Address(ADMIN).toScVal()],
    ['getExpectedTokenDecimals', () => xdr.ScVal.scvU32(7)],
    ['getEscrowBalance', () => nativeToScVal(5n, { type: 'i128' })],
  ] as const)('%s only simulates, from the null account', async (method, retval) => {
    const { adapter, server, simulateTransaction } = setup(success(retval()));
    const read = adapter[method] as (id?: bigint) => Promise<unknown>;
    await read.call(adapter, SHIPMENT_ID);

    expect(simulateTransaction).toHaveBeenCalledTimes(1);
    expect(simulateTransaction.mock.calls[0]![0].source).toBe(contract.NULL_ACCOUNT);
    expect(server.sendTransaction).not.toHaveBeenCalled();
    expect(server.getAccount).not.toHaveBeenCalled();
    expect(server.getTransaction).not.toHaveBeenCalled();
  });
});

describe('SorobanAdapter read decoding', () => {
  it('getVersion / getExpectedTokenDecimals decode u32', async () => {
    const { adapter, simulateTransaction } = setup(success(xdr.ScVal.scvU32(3)));
    await expect(adapter.getVersion()).resolves.toBe(3);
    expect(invocation(simulateTransaction.mock.calls[0]![0])).toEqual({
      name: 'get_version',
      args: [],
    });

    const decimals = setup(success(xdr.ScVal.scvU32(7)));
    await expect(decimals.adapter.getExpectedTokenDecimals()).resolves.toBe(7);
    expect(invocation(decimals.simulateTransaction.mock.calls[0]![0]).name).toBe(
      'get_expected_token_decimals'
    );
  });

  it('getAdmin decodes an address', async () => {
    const { adapter } = setup(success(new Address(ADMIN).toScVal()));
    await expect(adapter.getAdmin()).resolves.toBe(ADMIN);
  });

  it('getEscrowBalance passes the shipment id as u64 and decodes i128 as bigint', async () => {
    const big = 2n ** 70n;
    const { adapter, simulateTransaction } = setup(success(nativeToScVal(big, { type: 'i128' })));
    await expect(adapter.getEscrowBalance(SHIPMENT_ID)).resolves.toBe(big);

    const { name, args } = invocation(simulateTransaction.mock.calls[0]![0]);
    expect(name).toBe('get_escrow_balance');
    expect(args[0]!.switch()).toBe(xdr.ScValType.scvU64());
    expect(args[0]!.u64().toBigInt()).toBe(SHIPMENT_ID);
  });

  it('getShipmentStatus decodes the unit enum variant', async () => {
    const { adapter, simulateTransaction } = setup(success(xdr.ScVal.scvVec([sym('InTransit')])));
    await expect(adapter.getShipmentStatus(SHIPMENT_ID)).resolves.toBe('InTransit');
    expect(invocation(simulateTransaction.mock.calls[0]![0]).name).toBe('get_shipment_status');
  });

  it('getShipment decodes the struct, keeping bigints and mapping None to null', async () => {
    const struct = xdr.ScVal.scvMap([
      entry('carrier', new Address(ADMIN).toScVal()),
      entry('deadline', xdr.ScVal.scvVoid()),
      entry('id', nativeToScVal(SHIPMENT_ID, { type: 'u64' })),
      entry('status', xdr.ScVal.scvVec([sym('Delivered')])),
      entry('total_amount', nativeToScVal(1_000n, { type: 'i128' })),
    ]);
    const { adapter } = setup(success(struct));
    const shipment = await adapter.getShipment(SHIPMENT_ID);

    expect(shipment).toEqual({
      carrier: ADMIN,
      deadline: null,
      id: SHIPMENT_ID,
      status: ['Delivered'],
      total_amount: 1_000n,
    });
    expect(Object.isFrozen(shipment)).toBe(true);
  });

  it('rejects a return value of the wrong type', async () => {
    const { adapter } = setup(success(sym('nope')));
    await expect(adapter.getVersion()).rejects.toMatchObject({
      statusCode: 502,
      code: ErrorCodes.CHAIN_UNKNOWN,
    });
  });
});

describe('SorobanAdapter read errors', () => {
  it.each(['getShipment', 'getShipmentStatus', 'getEscrowBalance'] as const)(
    '%s resolves null on ShipmentNotFound (#4)',
    async method => {
      const { adapter } = setup(contractError(4));
      await expect(adapter[method](SHIPMENT_ID)).resolves.toBeNull();
    }
  );

  it('other contract errors reject with ERR_CHAIN_UNKNOWN and the contract code', async () => {
    const { adapter } = setup(contractError(2)); // NotInitialized
    await expect(adapter.getShipment(SHIPMENT_ID)).rejects.toMatchObject({
      code: ErrorCodes.CHAIN_UNKNOWN,
      details: { method: 'get_shipment', contractCode: 2 },
    });
  });

  it('ShipmentNotFound is not swallowed by non-shipment reads', async () => {
    const { adapter } = setup(contractError(4));
    await expect(adapter.getVersion()).rejects.toMatchObject({ code: ErrorCodes.CHAIN_UNKNOWN });
  });

  it('RPC transport failures reject with ERR_CHAIN_UNKNOWN', async () => {
    const { adapter } = setup(new Error('socket hang up'));
    await expect(adapter.getAdmin()).rejects.toMatchObject({
      statusCode: 502,
      code: ErrorCodes.CHAIN_UNKNOWN,
    });
  });

  it('requires a configured contract', async () => {
    const adapter = new SorobanAdapter({
      contractId: '',
      rpcServer: {} as rpc.Server,
      networkPassphrase: Networks.TESTNET,
    });
    await expect(adapter.getVersion()).rejects.toMatchObject({ code: ErrorCodes.CHAIN_UNKNOWN });
  });
});

describe('decoders', () => {
  it('decodeOption maps Void to null and decodes Some', () => {
    expect(decodeOption(xdr.ScVal.scvVoid(), decodeU32)).toBeNull();
    expect(decodeOption(xdr.ScVal.scvU32(9), decodeU32)).toBe(9);
  });

  it('decodeShipmentStatus rejects unknown variants and non-enum values', () => {
    expect(() => decodeShipmentStatus(xdr.ScVal.scvVec([sym('Teleported')]))).toThrow(
      /Unknown ShipmentStatus/
    );
    expect(() => decodeShipmentStatus(sym('Delivered'))).toThrow(/ShipmentStatus enum/);
  });
});

describe('checkChainReadiness', () => {
  const base = {
    anchorEvent: jest.fn(),
    releaseEscrow: jest.fn(),
    streamEvents: jest.fn(),
    getConfirmationCount: jest.fn(),
  } as unknown as ChainAdapter;

  it('reports version, admin and decimals when the contract answers', async () => {
    const adapter: ChainAdapter = {
      ...base,
      getVersion: async () => 3,
      getAdmin: async () => ADMIN,
      getExpectedTokenDecimals: async () => 7,
    };
    await expect(checkChainReadiness(adapter)).resolves.toEqual({
      status: 'ready',
      version: 3,
      admin: ADMIN,
      tokenDecimals: 7,
    });
  });

  it('skips adapters without contract reads (simulated mode)', async () => {
    await expect(checkChainReadiness(base)).resolves.toMatchObject({ status: 'skipped' });
  });

  it('reports unavailable instead of throwing when a read fails', async () => {
    const adapter: ChainAdapter = {
      ...base,
      getVersion: async () => {
        throw new Error('rpc down');
      },
      getAdmin: async () => ADMIN,
      getExpectedTokenDecimals: async () => 7,
    };
    await expect(checkChainReadiness(adapter)).resolves.toEqual({
      status: 'unavailable',
      error: 'rpc down',
    });
  });

  it('runs end to end against SorobanAdapter with simulation only', async () => {
    const { adapter, server, simulateTransaction } = setup(success(xdr.ScVal.scvU32(3)));
    simulateTransaction
      .mockResolvedValueOnce(success(xdr.ScVal.scvU32(3)))
      .mockResolvedValueOnce(success(new Address(ADMIN).toScVal()))
      .mockResolvedValueOnce(success(xdr.ScVal.scvU32(7)));

    await expect(checkChainReadiness(adapter)).resolves.toMatchObject({ status: 'ready' });
    expect(server.sendTransaction).not.toHaveBeenCalled();
  });
});
