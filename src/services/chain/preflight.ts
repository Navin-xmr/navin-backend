/**
 * Preflight checks run before a chain submission is signed (#1081).
 *
 * Each check reads on-chain state through a `ChainStateReader` and fails fast
 * with an actionable `ERR_CHAIN_*` error, instead of paying for a simulation
 * that is certain to be rejected. Checks are individually switchable through
 * `CHAIN_PREFLIGHT_ENABLED` / `CHAIN_PREFLIGHT_CHECKS`.
 *
 * | Check            | Fails with                           | HTTP |
 * |------------------|--------------------------------------|------|
 * | `initialized`    | ERR_CHAIN_NOT_INITIALIZED            | 503  |
 * | `roles`          | ERR_CHAIN_ROLE_REQUIRED              | 403  |
 * | `whitelist`      | ERR_CHAIN_CARRIER_NOT_WHITELISTED    | 403  |
 * | `suspension`     | ERR_CHAIN_ACTOR_SUSPENDED            | 403  |
 * | `token_decimals` | ERR_CHAIN_INVALID_TOKEN_DECIMALS     | 422  |
 */
import { REQUIRED_TOKEN_DECIMALS } from '../../config/chainPreflight.js';
import type { ChainPreflightCheck } from '../../config/chainPreflight.js';
import { AppError, ErrorCodes } from '../../shared/http/errors.js';

export type ChainRole = 'Company' | 'Carrier';

/** Roles that may submit shipment events. */
export const SUBMITTING_ROLES: readonly ChainRole[] = ['Company', 'Carrier'];

/** Read-only view of the contract state the checks need. */
export interface ChainStateReader {
  isInitialized(): Promise<boolean>;
  hasRole(address: string, role: ChainRole): Promise<boolean>;
  isCarrierWhitelisted(address: string): Promise<boolean>;
  isSuspended(address: string): Promise<boolean>;
  /** Decimals reported by the token contract (SEP-41 `decimals()`). */
  getTokenDecimals(token: string): Promise<number>;
}

export interface ChainPreflightConfig {
  enabled: boolean;
  checks: readonly ChainPreflightCheck[];
}

/** What is about to be submitted. A check is skipped when its input is absent. */
export interface PreflightSubject {
  /** Address that signs/acts (the `actor` of `anchor`). */
  actor?: string;
  /** Escrow token contract (for escrow initialisation). */
  token?: string;
}

/**
 * Run the enabled checks in a fixed order: initialized, roles, whitelist,
 * suspension, token decimals. Resolves when every enabled check passes.
 * @throws {AppError} The first failing check's error.
 */
export async function runChainPreflight(
  reader: ChainStateReader,
  subject: PreflightSubject,
  config: ChainPreflightConfig
): Promise<void> {
  if (!config.enabled) return;
  const enabled = new Set<ChainPreflightCheck>(config.checks);

  if (enabled.has('initialized') && !(await reader.isInitialized())) {
    throw new AppError(
      503,
      'The escrow contract is not initialized. Call initialize() on the contract before submitting events.',
      ErrorCodes.CHAIN_NOT_INITIALIZED
    );
  }

  const { actor, token } = subject;
  if (actor) {
    // Roles are read once and reused by the roles and whitelist checks.
    let roles: ChainRole[] | undefined;
    const rolesOf = async (): Promise<ChainRole[]> => {
      roles ??= (
        await Promise.all(
          SUBMITTING_ROLES.map(async role => ((await reader.hasRole(actor, role)) ? role : null))
        )
      ).filter((role): role is ChainRole => role !== null);
      return roles;
    };

    if (enabled.has('roles') && (await rolesOf()).length === 0) {
      throw new AppError(
        403,
        `Address ${actor} holds neither the Company nor the Carrier role. Grant one of them on the contract first.`,
        ErrorCodes.CHAIN_ROLE_REQUIRED,
        { actor, requiredRoles: SUBMITTING_ROLES }
      );
    }

    if (enabled.has('whitelist')) {
      const held = await rolesOf();
      // A Company-role actor is not subject to the carrier whitelist.
      if (held.includes('Carrier') && !held.includes('Company')) {
        if (!(await reader.isCarrierWhitelisted(actor))) {
          throw new AppError(
            403,
            `Carrier ${actor} is not whitelisted. A Company must whitelist the carrier before it can submit events.`,
            ErrorCodes.CHAIN_CARRIER_NOT_WHITELISTED,
            { actor }
          );
        }
      }
    }

    if (enabled.has('suspension') && (await reader.isSuspended(actor))) {
      throw new AppError(
        403,
        `Address ${actor} is suspended on the contract. Lift the suspension before submitting events.`,
        ErrorCodes.CHAIN_ACTOR_SUSPENDED,
        { actor }
      );
    }
  }

  if (token && enabled.has('token_decimals')) {
    const decimals = await reader.getTokenDecimals(token);
    if (decimals !== REQUIRED_TOKEN_DECIMALS) {
      throw new AppError(
        422,
        `Token ${token} has ${decimals} decimals; the escrow requires ${REQUIRED_TOKEN_DECIMALS}. Use a 7-decimal Stellar asset contract.`,
        ErrorCodes.CHAIN_INVALID_TOKEN_DECIMALS,
        { token, decimals, expected: REQUIRED_TOKEN_DECIMALS }
      );
    }
  }
}
