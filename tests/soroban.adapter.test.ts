import { describe, expect, it, jest } from '@jest/globals';
import { Account, Keypair } from '@stellar/stellar-sdk';
import { SorobanAdapter } from '../src/services/chain/soroban.adapter.js';
import { ErrorCodes } from '../src/shared/http/errors.js';

describe('SorobanAdapter pipeline', () => {
  const mockSecretKey = 'SDW5W3FNA2J7FPGG6JQKQ7E5J67VMBZ3J27K4X6K4T4M7Z4K4X6K4T4M'; // Sample test secret key

  it('rejects invalid data_hash in anchorEvent before RPC call', async () => {
    const adapter = new SorobanAdapter({
      secretKey: mockSecretKey,
      contractId: 'CACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAINCW',
    });
    await expect(
      adapter.anchorEvent({
        shipment_id: 'ship123',
        data_hash: 'invalid-hash',
        actor: 'GABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEJXA',
      })
    ).rejects.toMatchObject({
      code: ErrorCodes.CHAIN_INVALID_HASH,
      statusCode: 422,
    });
  });

  it('rejects an invalid caller in releaseEscrow before RPC call (v2)', async () => {
    const adapter = new SorobanAdapter({
      secretKey: mockSecretKey,
      contractId: 'CACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAINCW',
    });
    await expect(
      adapter.releaseEscrow({
        caller: 'not-an-address',
        shipment_id: 'ship123',
      })
    ).rejects.toMatchObject({
      code: ErrorCodes.CHAIN_UNAUTHORIZED,
      statusCode: 422,
    });
  });

  it('throws ERR_CHAIN_UNKNOWN if secret key or contract id is missing', async () => {
    const adapter = new SorobanAdapter({ secretKey: undefined });
    await expect(
      adapter.anchorEvent({
        shipment_id: 'ship123',
        data_hash: 'a'.repeat(64),
        actor: 'GABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEJXA',
      })
    ).rejects.toMatchObject({
      code: ErrorCodes.CHAIN_UNKNOWN,
      statusCode: 500,
    });
  });

  it.each([
    ['Error(Contract, #10)', 'ERR_CHAIN_MISSING_AUTH'],
    ['insufficient budget', 'ERR_CHAIN_INSUFFICIENT_BUDGET'],
    ['missing trustline', 'ERR_CHAIN_MISSING_TRUSTLINE'],
  ])('stops after a failed simulation: %s', async (rawError, expectedCode) => {
    const keypair = Keypair.random();
    const sendTransaction = jest.fn();
    const rpcServer = {
      getAccount: jest.fn(async () => new Account(keypair.publicKey(), '1')),
      simulateTransaction: jest.fn(async () => ({ error: rawError })),
      sendTransaction,
    };

    const adapter = new SorobanAdapter({
      secretKey: keypair.secret(),
      contractId: 'CACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAINCW',
      rpcServer: rpcServer as never,
    });

    await expect(
      adapter.anchorEvent({
        shipment_id: 'ship123',
        data_hash: 'a'.repeat(64),
        actor: keypair.publicKey(),
      })
    ).rejects.toMatchObject({ code: expectedCode });
    expect(sendTransaction).not.toHaveBeenCalled();
  });
});
