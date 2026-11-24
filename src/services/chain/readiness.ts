/**
 * Startup chain readiness check (P12-14).
 *
 * Confirms the configured contract answers read calls before the API starts
 * serving, and logs its version, admin and token decimals. Reads are
 * simulation-only, so the check costs no fee and needs no signing key.
 *
 * Non-fatal by design: a chain/RPC outage is reported, but the API still
 * starts so off-chain features keep working.
 */
import { logger } from '../../shared/logger/logger.js';
import type { ChainAdapter } from './types.js';

export type ChainReadiness =
  | { status: 'ready'; version: number; admin: string; tokenDecimals: number }
  | { status: 'skipped'; reason: string }
  | { status: 'unavailable'; error: string };

export async function checkChainReadiness(adapter: ChainAdapter): Promise<ChainReadiness> {
  const { getVersion, getAdmin, getExpectedTokenDecimals } = adapter;
  if (!getVersion || !getAdmin || !getExpectedTokenDecimals) {
    const result = {
      status: 'skipped',
      reason: 'adapter has no contract reads (simulated mode)',
    } as const;
    logger.info(result, 'Chain readiness check skipped');
    return result;
  }

  try {
    const [version, admin, tokenDecimals] = await Promise.all([
      getVersion.call(adapter),
      getAdmin.call(adapter),
      getExpectedTokenDecimals.call(adapter),
    ]);
    const result = { status: 'ready', version, admin, tokenDecimals } as const;
    logger.info(result, 'Chain contract is reachable');
    return result;
  } catch (err) {
    const result = {
      status: 'unavailable',
      error: err instanceof Error ? err.message : String(err),
    } as const;
    logger.error(result, 'Chain readiness check failed; starting without a verified contract');
    return result;
  }
}
