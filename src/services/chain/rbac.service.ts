/**
 * On-chain RBAC provisioning (#1042 · P14-10).
 *
 * Wires `add_company` / `add_carrier` / `add_carrier_to_whitelist` (ChainAdapter
 * port, src/services/chain/types.ts) to the org/user lifecycle: organizations
 * provision a company role on creation, carrier users are whitelisted once both
 * the organization and the carrier have an on-chain address. Every call
 * preflights with `ChainAdapter.preflightRole()` first, so a caller lacking the
 * on-chain role gets an actionable error before a transaction is ever sent, and
 * every outcome (provisioned or denied) is written to the audit trail.
 */
import { AppError, ErrorCodes } from '../../shared/http/errors.js';
import { auditLog } from '../../shared/utils/auditLog.js';
import { getChainActorAddress, getChainAdapter } from './factory.js';
import type { ChainAdapter, RoleProvisionAction } from './types.js';

async function provisionRole(params: {
  action: RoleProvisionAction;
  adapter: ChainAdapter;
  admin: string;
  args: { admin: string; company: string; carrier?: string };
  resourceId: string;
  actorUserId?: string;
}): Promise<{ txHash: string }> {
  const { action, adapter, args, resourceId, actorUserId } = params;
  const preflight = await adapter.preflightRole(action, args);

  if (!preflight.allowed) {
    auditLog({
      userId: actorUserId ?? 'system',
      action: 'RBAC_ROLE_MODIFIED',
      resourceId,
      timestamp: new Date(),
      metadata: { chainAction: action, success: false, reason: preflight.reason, args },
    });
    throw new AppError(
      403,
      `Caller lacks the on-chain role required for ${action}`,
      preflight.reason ?? ErrorCodes.CHAIN_ROLE_DENIED
    );
  }

  const receipt =
    action === 'add_company'
      ? await adapter.addCompany(args)
      : action === 'add_carrier'
        ? await adapter.addCarrier(args as { admin: string; company: string; carrier: string })
        : await adapter.addCarrierToWhitelist(
            args as { admin: string; company: string; carrier: string }
          );

  auditLog({
    userId: actorUserId ?? 'system',
    action: 'RBAC_ROLE_MODIFIED',
    resourceId,
    timestamp: new Date(),
    metadata: { chainAction: action, success: true, txHash: receipt.txHash, args },
  });

  return { txHash: receipt.txHash };
}

/**
 * Provision a company role for an organization. Called from org lifecycle
 * (`createOrganizationService`) whenever the organization has an on-chain
 * `walletAddress` — organizations without one are not provisioned on-chain.
 */
export async function provisionCompanyRole(
  input: { organizationId: string; companyAddress: string; actorUserId?: string },
  adapter: ChainAdapter = getChainAdapter()
): Promise<{ txHash: string }> {
  const admin = getChainActorAddress();
  return provisionRole({
    action: 'add_company',
    adapter,
    admin,
    args: { admin, company: input.companyAddress },
    resourceId: input.organizationId,
    actorUserId: input.actorUserId,
  });
}

/**
 * Register a carrier and whitelist it for one company. Called from user
 * lifecycle whenever a DRIVER-role user and their organization both have an
 * on-chain address.
 */
export async function provisionCarrierRole(
  input: {
    organizationId: string;
    companyAddress: string;
    carrierUserId: string;
    carrierAddress: string;
    actorUserId?: string;
  },
  adapter: ChainAdapter = getChainAdapter()
): Promise<{ addCarrierTxHash: string; whitelistTxHash: string }> {
  const admin = getChainActorAddress();
  const args = { admin, company: input.companyAddress, carrier: input.carrierAddress };

  const added = await provisionRole({
    action: 'add_carrier',
    adapter,
    admin,
    args,
    resourceId: input.carrierUserId,
    actorUserId: input.actorUserId,
  });
  const whitelisted = await provisionRole({
    action: 'add_carrier_to_whitelist',
    adapter,
    admin,
    args,
    resourceId: input.carrierUserId,
    actorUserId: input.actorUserId,
  });

  return { addCarrierTxHash: added.txHash, whitelistTxHash: whitelisted.txHash };
}
