/**
 * #1042 — on-chain RBAC provisioning service.
 *
 * `provisionCompanyRole`/`provisionCarrierRole` must preflight before ever
 * submitting a transaction, fail with an actionable error for an
 * unprovisioned/unauthorized caller, and write an audit trail entry either way.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { ChainAdapter } from '../src/services/chain/types.js';

const auditLogMock = jest.fn();
await jest.unstable_mockModule('../src/shared/utils/auditLog.js', () => ({
  auditLog: auditLogMock,
}));

const ADMIN = `G${'A'.repeat(55)}`;
await jest.unstable_mockModule('../src/services/chain/factory.js', () => ({
  getChainActorAddress: jest.fn(() => ADMIN),
  getChainAdapter: jest.fn(),
}));

const { AppError, ErrorCodes } = await import('../src/shared/http/errors.js');
const { provisionCompanyRole, provisionCarrierRole } =
  await import('../src/services/chain/rbac.service.js');

const COMPANY = `G${'B'.repeat(55)}`;
const CARRIER = `G${'C'.repeat(55)}`;

function fakeAdapter(overrides: Partial<ChainAdapter>): ChainAdapter {
  return {
    anchorEvent: jest.fn(),
    releaseEscrow: jest.fn(),
    createShipment: jest.fn(),
    raiseDispute: jest.fn(),
    resolveDispute: jest.fn(),
    addCompany: jest.fn(async () => ({ txHash: 'a'.repeat(64), ledger: 1, simulated: false })),
    addCarrier: jest.fn(async () => ({ txHash: 'b'.repeat(64), ledger: 1, simulated: false })),
    addCarrierToWhitelist: jest.fn(async () => ({
      txHash: 'c'.repeat(64),
      ledger: 1,
      simulated: false,
    })),
    preflightRole: jest.fn(async () => ({ allowed: true })),
    streamEvents: jest.fn(),
    getConfirmationCount: jest.fn(),
    ...overrides,
  } as unknown as ChainAdapter;
}

describe('provisionCompanyRole', () => {
  beforeEach(() => auditLogMock.mockClear());

  it('provisions a company for an authorized caller and audits success', async () => {
    const adapter = fakeAdapter({});
    const result = await provisionCompanyRole(
      { organizationId: 'org1', companyAddress: COMPANY },
      adapter
    );

    expect(adapter.preflightRole).toHaveBeenCalledWith('add_company', {
      admin: ADMIN,
      company: COMPANY,
    });
    expect(adapter.addCompany).toHaveBeenCalledWith({ admin: ADMIN, company: COMPANY });
    expect(result.txHash).toBe('a'.repeat(64));
    expect(auditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'RBAC_ROLE_MODIFIED',
        resourceId: 'org1',
        metadata: expect.objectContaining({ chainAction: 'add_company', success: true }),
      })
    );
  });

  it('fails with an actionable error for an unprovisioned/unauthorized caller — never submits', async () => {
    const adapter = fakeAdapter({
      preflightRole: jest.fn(async () => ({
        allowed: false,
        reason: ErrorCodes.CHAIN_ROLE_DENIED,
      })),
    });

    await expect(
      provisionCompanyRole({ organizationId: 'org1', companyAddress: COMPANY }, adapter)
    ).rejects.toMatchObject({ statusCode: 403, code: ErrorCodes.CHAIN_ROLE_DENIED });

    expect(adapter.addCompany).not.toHaveBeenCalled();
    expect(auditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'RBAC_ROLE_MODIFIED',
        metadata: expect.objectContaining({ chainAction: 'add_company', success: false }),
      })
    );
  });

  it('propagates AppError instances', async () => {
    const adapter = fakeAdapter({
      preflightRole: jest.fn(async () => ({
        allowed: false,
        reason: ErrorCodes.CHAIN_ROLE_DENIED,
      })),
    });
    await expect(
      provisionCompanyRole({ organizationId: 'org1', companyAddress: COMPANY }, adapter)
    ).rejects.toBeInstanceOf(AppError);
  });
});

describe('provisionCarrierRole', () => {
  beforeEach(() => auditLogMock.mockClear());

  it('registers and whitelists a carrier when both preflights pass', async () => {
    const adapter = fakeAdapter({});
    const result = await provisionCarrierRole(
      {
        organizationId: 'org1',
        companyAddress: COMPANY,
        carrierUserId: 'user1',
        carrierAddress: CARRIER,
      },
      adapter
    );

    expect(adapter.addCarrier).toHaveBeenCalledWith({
      admin: ADMIN,
      company: COMPANY,
      carrier: CARRIER,
    });
    expect(adapter.addCarrierToWhitelist).toHaveBeenCalledWith({
      admin: ADMIN,
      company: COMPANY,
      carrier: CARRIER,
    });
    expect(result).toEqual({
      addCarrierTxHash: 'b'.repeat(64),
      whitelistTxHash: 'c'.repeat(64),
    });
  });

  it('stops at whichever RBAC step the caller lacks the role for', async () => {
    const adapter = fakeAdapter({
      preflightRole: jest.fn(async (action: string) =>
        action === 'add_carrier'
          ? { allowed: true }
          : { allowed: false, reason: ErrorCodes.CHAIN_ROLE_DENIED }
      ),
    });

    await expect(
      provisionCarrierRole(
        {
          organizationId: 'org1',
          companyAddress: COMPANY,
          carrierUserId: 'user1',
          carrierAddress: CARRIER,
        },
        adapter
      )
    ).rejects.toMatchObject({ statusCode: 403, code: ErrorCodes.CHAIN_ROLE_DENIED });

    expect(adapter.addCarrier).toHaveBeenCalledTimes(1);
    expect(adapter.addCarrierToWhitelist).not.toHaveBeenCalled();
  });
});
