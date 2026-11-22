/**
 * #1042 — ChainAdapter.preflightRole() reports missing role/whitelist state
 * before a transaction is ever submitted.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { Account, Keypair, Networks } from '@stellar/stellar-sdk';

import { SimulatedAdapter } from '../src/services/chain/simulated.adapter.js';
import { SorobanAdapter } from '../src/services/chain/soroban.adapter.js';
import { ErrorCodes } from '../src/shared/http/errors.js';

const signer = Keypair.random();
const ADMIN = signer.publicKey();
const COMPANY = Keypair.random().publicKey();
const CARRIER = Keypair.random().publicKey();
const CONTRACT_ID = 'CACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAINCW';

describe('SorobanAdapter.preflightRole', () => {
  function adapterWithSim(simulateTransaction: () => Promise<unknown>) {
    const rpcStub = {
      getAccount: jest.fn(async (pk: string) => new Account(pk, '100')),
      simulateTransaction,
    };
    return new SorobanAdapter({
      secretKey: signer.secret(),
      contractId: CONTRACT_ID,
      networkPassphrase: Networks.TESTNET,
      rpcServer: rpcStub as never,
    });
  }

  it('reports allowed:true for a provisioned/authorized caller — no tx is sent', async () => {
    const adapter = adapterWithSim(async () => ({}));
    const result = await adapter.preflightRole('add_company', { admin: ADMIN, company: COMPANY });
    expect(result).toEqual({ allowed: true });
  });

  it('reports the exact ERR_CHAIN_* for an unprovisioned/unauthorized caller — no tx is sent', async () => {
    const adapter = adapterWithSim(async () => ({
      error: 'HostError: Error(Contract, #10)',
    }));
    // isSimulationError checks for an `error` string — stub it minimally via rpc.Api.
    const { rpc } = await import('@stellar/stellar-sdk');
    jest.spyOn(rpc.Api, 'isSimulationError').mockReturnValueOnce(true);

    const result = await adapter.preflightRole('add_carrier_to_whitelist', {
      admin: ADMIN,
      company: COMPANY,
      carrier: CARRIER,
    });

    expect(result).toEqual({ allowed: false, reason: ErrorCodes.CHAIN_ROLE_DENIED });
  });
});

describe('SimulatedAdapter.preflightRole', () => {
  it('always reports allowed — there is no on-chain role state to deny', async () => {
    const adapter = new SimulatedAdapter({ secretKey: signer.secret() });
    await expect(
      adapter.preflightRole('add_company', { admin: ADMIN, company: COMPANY })
    ).resolves.toEqual({ allowed: true });
  });
});
