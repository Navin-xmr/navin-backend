import { describe, expect, it } from '@jest/globals';

import { SimulatedAdapter } from '../src/services/chain/simulated.adapter.js';
import { SorobanAdapter } from '../src/services/chain/soroban.adapter.js';
import type { ChainAdapter } from '../src/services/chain/types.js';
import { ErrorCodes } from '../src/shared/http/errors.js';

const adapterBindings: Array<[string, () => ChainAdapter]> = [
  ['simulated', () => new SimulatedAdapter({ secretKey: '' })],
  ['soroban', () => new SorobanAdapter({ secretKey: '' })],
];

describe.each(adapterBindings)('%s ChainAdapter contract', (_binding, createAdapter) => {
  it('rejects malformed anchor hashes with the shared port error', async () => {
    await expect(
      createAdapter().anchorEvent({
        shipment_id: 'shipment_1',
        data_hash: 'not-a-hash',
        actor: 'GABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEJXA',
      })
    ).rejects.toMatchObject({ statusCode: 422, code: ErrorCodes.CHAIN_INVALID_HASH });
  });

  it('rejects malformed proof hashes with the shared port error', async () => {
    await expect(
      createAdapter().releaseEscrow({ payment_id: 'payment_1', proof_hash: 'not-a-hash' })
    ).rejects.toMatchObject({ statusCode: 422, code: ErrorCodes.CHAIN_INVALID_PROOF });
  });
});