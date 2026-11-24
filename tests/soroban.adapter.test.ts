import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { rpc } from '@stellar/stellar-sdk';
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

  it('surfaces malformed RPC events and continues yielding later events', async () => {
    const contractId = 'CACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAINCW';
    const rpcServer = {
      getEvents: jest.fn(async () => ({
        events: [
          {
            id: 'evt-malformed',
            contractId,
            txHash: '11'.repeat(32),
            ledger: 100,
            ledgerClosedAt: '2026-09-27T10:00:00Z',
            topic: ['anchor', 'shipment_1'],
            value: ['not-a-hash', 100],
          },
          {
            id: 'evt-valid',
            contractId,
            txHash: '22'.repeat(32),
            ledger: 101,
            ledgerClosedAt: '2026-09-27T10:00:01Z',
            topic: ['anchor', 'shipment_1'],
            value: ['a'.repeat(64), 101],
          },
        ],
      })),
    };
    const adapter = new SorobanAdapter({
      contractId,
      rpcServer: rpcServer as unknown as rpc.Server,
    });
    const events = [];

    for await (const event of adapter.streamEventsWithFailures()) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      kind: 'decode_error',
      cursor: 'evt-malformed',
      contract_id: contractId,
      raw_payload: expect.objectContaining({ id: 'evt-malformed' }),
    });
    expect(events[1]).toMatchObject({ id: 'evt-valid', name: 'anchor' });
  });
});
