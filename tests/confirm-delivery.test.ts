import { describe, expect, it } from '@jest/globals';
import { Account, Keypair } from '@stellar/stellar-sdk';
import type { Transaction } from '@stellar/stellar-sdk';
import { SorobanAdapter } from '../src/services/chain/soroban.adapter.js';
import { SimulatedAdapter } from '../src/services/chain/simulated.adapter.js';
import { AppError, ErrorCodes } from '../src/shared/http/errors.js';

const VALID_PROOF_HASH = '3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d';
const VALID_SHIPMENT_ID = 'ship-abc123';

/** Generate a random test keypair. The public key is the address the adapter signs as. */
function makeKeyPair(): { secret: string; publicKey: string } {
  const kp = Keypair.random();
  return { secret: kp.secret(), publicKey: kp.publicKey() };
}

/** Minimal mock Horizon client for SimulatedAdapter success-path tests. */
function createMockHorizon(publicKey: string): {
  loadAccount: () => Promise<Account>;
  submitTransaction: (tx: Transaction) => Promise<{ hash: string; ledger: number }>;
} {
  return {
    loadAccount: async () => new Account(publicKey, '100'),
    submitTransaction: async (_tx: Transaction) => ({
      hash: '8e1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b',
      ledger: 512600,
    }),
  };
}

describe('confirmDelivery — ABI args and auth precondition', () => {
  it('rejects invalid proof_hash before any contract call', async () => {
    const { secret, publicKey } = makeKeyPair();
    const adapter = new SorobanAdapter({
      secretKey: secret,
      contractId: 'CACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAINCW',
    });

    await expect(
      adapter.confirmDelivery({
        receiver: publicKey,
        shipment_id: VALID_SHIPMENT_ID,
        proof_hash: 'short',
      })
    ).rejects.toMatchObject({
      code: ErrorCodes.CHAIN_INVALID_PROOF,
      statusCode: 422,
    });
  });

  it('rejects when receiver does not match the signing key (auth precondition)', async () => {
    const { secret } = makeKeyPair();
    const wrongReceiver = Keypair.random().publicKey();
    const adapter = new SorobanAdapter({
      secretKey: secret,
      contractId: 'CACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAINCW',
    });

    // Receiver differs from the signer's public key → must throw before RPC.
    await expect(
      adapter.confirmDelivery({
        receiver: wrongReceiver,
        shipment_id: VALID_SHIPMENT_ID,
        proof_hash: VALID_PROOF_HASH,
      })
    ).rejects.toMatchObject({
      code: ErrorCodes.CHAIN_UNAUTHORIZED,
      statusCode: 403,
    });
  });

  it('accepts matching receiver and valid proof_hash (encoded args pass validation)', async () => {
    const { secret, publicKey } = makeKeyPair();
    const adapter = new SorobanAdapter({
      secretKey: secret,
      contractId: 'CACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAINCW',
    });

    // Valid input: receiver == signer public key, proof_hash is valid hex64.
    // The method should pass validation and auth, proceeding to the RPC pipeline.
    // It will fail at RPC (no real server), but not at validation/auth.
    await expect(
      adapter.confirmDelivery({
        receiver: publicKey,
        shipment_id: VALID_SHIPMENT_ID,
        proof_hash: VALID_PROOF_HASH,
      })
    ).rejects.not.toMatchObject({
      code: ErrorCodes.CHAIN_INVALID_PROOF,
    });
    await expect(
      adapter.confirmDelivery({
        receiver: publicKey,
        shipment_id: VALID_SHIPMENT_ID,
        proof_hash: VALID_PROOF_HASH,
      })
    ).rejects.not.toMatchObject({
      code: ErrorCodes.CHAIN_UNAUTHORIZED,
    });
  });

  it('simulated adapter enforces the same auth precondition', async () => {
    const { secret } = makeKeyPair();
    const wrongReceiver = Keypair.random().publicKey();
    const adapter = new SimulatedAdapter({ secretKey: secret });

    await expect(
      adapter.confirmDelivery({
        receiver: wrongReceiver,
        shipment_id: VALID_SHIPMENT_ID,
        proof_hash: VALID_PROOF_HASH,
      })
    ).rejects.toMatchObject({
      code: ErrorCodes.CHAIN_UNAUTHORIZED,
      statusCode: 403,
    });
  });

  it('simulated adapter accepts matching receiver', async () => {
    const { secret, publicKey } = makeKeyPair();
    const adapter = new SimulatedAdapter({
      secretKey: secret,
      horizon: createMockHorizon(publicKey),
    });

    const result = await adapter.confirmDelivery({
      receiver: publicKey,
      shipment_id: VALID_SHIPMENT_ID,
      proof_hash: VALID_PROOF_HASH,
    });

    expect(result.simulated).toBe(true);
    expect(result.receiver).toBe(publicKey);
    expect(result.shipmentId).toBe(VALID_SHIPMENT_ID);
    expect(result.txHash).toBeDefined();
    expect(typeof result.ledger).toBe('number');
  });

  it('rejects missing secret key', async () => {
    const adapter = new SorobanAdapter({ secretKey: undefined });
    await expect(
      adapter.confirmDelivery({
        receiver: Keypair.random().publicKey(),
        shipment_id: VALID_SHIPMENT_ID,
        proof_hash: VALID_PROOF_HASH,
      })
    ).rejects.toMatchObject({
      code: ErrorCodes.CHAIN_UNKNOWN,
      statusCode: 500,
    });
  });

  it('rejects missing contract id', async () => {
    const { secret, publicKey } = makeKeyPair();
    const adapter = new SorobanAdapter({
      secretKey: secret,
      contractId: undefined,
    });
    await expect(
      adapter.confirmDelivery({
        receiver: publicKey,
        shipment_id: VALID_SHIPMENT_ID,
        proof_hash: VALID_PROOF_HASH,
      })
    ).rejects.toMatchObject({
      code: ErrorCodes.CHAIN_UNKNOWN,
      statusCode: 500,
    });
  });

  it('throws AppError (not bare Error) on auth precondition failure', async () => {
    const { secret } = makeKeyPair();
    const wrongReceiver = Keypair.random().publicKey();
    const adapter = new SorobanAdapter({
      secretKey: secret,
      contractId: 'CACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAINCW',
    });

    let thrown: unknown;
    try {
      await adapter.confirmDelivery({
        receiver: wrongReceiver,
        shipment_id: VALID_SHIPMENT_ID,
        proof_hash: VALID_PROOF_HASH,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe(ErrorCodes.CHAIN_UNAUTHORIZED);
    expect((thrown as AppError).statusCode).toBe(403);
  });
});
