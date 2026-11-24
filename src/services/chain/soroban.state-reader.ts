/**
 * Read-only `ChainStateReader` over Soroban RPC simulation (#1081).
 *
 * ASSUMED CONTRACT ABI: the view functions below are the names this reader
 * calls. docs/chain-interface.md does not specify them yet, so confirm them
 * against the deployed contract (and update `CONTRACT_VIEW_FUNCTIONS`) before
 * enabling `CHAIN_PREFLIGHT_ENABLED`. `decimals` on the token is the standard
 * SEP-41 interface and needs no assumption.
 */
import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';

import { AppError, ErrorCodes } from '../../shared/http/errors.js';

import type { ChainRole, ChainStateReader } from './preflight.js';

export const CONTRACT_VIEW_FUNCTIONS = {
  isInitialized: 'is_initialized',
  hasRole: 'has_role',
  isCarrierWhitelisted: 'is_carrier_whitelisted',
  isSuspended: 'is_suspended',
} as const;

export interface SorobanStateReaderOptions {
  server: rpc.Server;
  contractId: string;
  networkPassphrase: string;
  /** Any funded or unfunded account; simulations never submit or sign. */
  sourcePublicKey: string;
}

export class SorobanStateReader implements ChainStateReader {
  constructor(private readonly options: SorobanStateReaderOptions) {}

  async isInitialized(): Promise<boolean> {
    return this.asBoolean(
      CONTRACT_VIEW_FUNCTIONS.isInitialized,
      await this.view(this.options.contractId, CONTRACT_VIEW_FUNCTIONS.isInitialized)
    );
  }

  async hasRole(address: string, role: ChainRole): Promise<boolean> {
    return this.asBoolean(
      CONTRACT_VIEW_FUNCTIONS.hasRole,
      await this.view(this.options.contractId, CONTRACT_VIEW_FUNCTIONS.hasRole, [
        new Address(address).toScVal(),
        nativeToScVal(role, { type: 'symbol' }),
      ])
    );
  }

  async isCarrierWhitelisted(address: string): Promise<boolean> {
    return this.asBoolean(
      CONTRACT_VIEW_FUNCTIONS.isCarrierWhitelisted,
      await this.view(this.options.contractId, CONTRACT_VIEW_FUNCTIONS.isCarrierWhitelisted, [
        new Address(address).toScVal(),
      ])
    );
  }

  async isSuspended(address: string): Promise<boolean> {
    return this.asBoolean(
      CONTRACT_VIEW_FUNCTIONS.isSuspended,
      await this.view(this.options.contractId, CONTRACT_VIEW_FUNCTIONS.isSuspended, [
        new Address(address).toScVal(),
      ])
    );
  }

  async getTokenDecimals(token: string): Promise<number> {
    const value = await this.view(token, 'decimals');
    const decimals = typeof value === 'bigint' ? Number(value) : value;
    if (typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0) {
      throw new AppError(
        502,
        `Token ${token} returned an invalid decimals() value`,
        ErrorCodes.CHAIN_UNKNOWN
      );
    }
    return decimals;
  }

  private asBoolean(fn: string, value: unknown): boolean {
    if (typeof value !== 'boolean') {
      throw new AppError(
        502,
        `Chain state read ${fn}() did not return a boolean`,
        ErrorCodes.CHAIN_UNKNOWN
      );
    }
    return value;
  }

  private async view(contractId: string, fn: string, args: xdr.ScVal[] = []): Promise<unknown> {
    const account = new Account(this.options.sourcePublicKey, '0');
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.options.networkPassphrase,
    })
      .addOperation(new Contract(contractId).call(fn, ...args))
      .setTimeout(30)
      .build();

    let simulation: rpc.Api.SimulateTransactionResponse;
    try {
      simulation = await this.options.server.simulateTransaction(tx);
    } catch (err) {
      throw new AppError(502, `Chain state read ${fn}() failed`, ErrorCodes.CHAIN_UNKNOWN, {
        cause: err instanceof Error ? err.message : String(err),
      });
    }
    if (rpc.Api.isSimulationError(simulation)) {
      throw new AppError(
        502,
        `Chain state read ${fn}() failed: ${simulation.error}`,
        ErrorCodes.CHAIN_UNKNOWN
      );
    }
    const retval = simulation.result?.retval;
    if (!retval) {
      throw new AppError(
        502,
        `Chain state read ${fn}() returned no value`,
        ErrorCodes.CHAIN_UNKNOWN
      );
    }
    return scValToNative(retval);
  }
}
