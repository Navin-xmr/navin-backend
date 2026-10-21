import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { SorobanAdapter } from '../src/services/chain/soroban.adapter.js';
import { AppError, ErrorCodes } from '../src/shared/http/errors.js';

describe('SorobanAdapter pipeline', () => {
  const mockSecretKey = 'SDW5W3FNA2J7FPGG6JQKQ7E5J67VMBZ3J27K4X6K4T4M7Z4K4X6K4T4M'; // Sample test secret key

  it('rejects invalid data_hash in anchorEvent before RPC call', async () => {
    const adapter = new SorobanAdapter({ secretKey: mockSecretKey, contractId: 'CACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAINCW' });
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

  it('rejects invalid proof_hash in releaseEscrow before RPC call', async () => {
    const adapter = new SorobanAdapter({ secretKey: mockSecretKey, contractId: 'CACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAINCW' });
    await expect(
      adapter.releaseEscrow({
        payment_id: 'pay123',
        proof_hash: 'short',
      })
    ).rejects.toMatchObject({
      code: ErrorCodes.CHAIN_INVALID_PROOF,
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
});
