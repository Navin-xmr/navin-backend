#!/usr/bin/env node
/**
 * Standalone Stellar Quickstart RPC & Horizon Health Probe (Issue #806 / P6-19).
 *
 * Verifies that a local `stellar/quickstart --standalone --enable-soroban-rpc`
 * node has finished booting both Soroban JSON-RPC (`getHealth` -> `healthy`
 * with `latestLedger >= 1`) and Horizon HTTP root before integration or nightly
 * test suites execute.
 *
 * Usage:
 *   node scripts/stellar-quickstart-health.mjs
 *
 * Environment:
 *   SOROBAN_RPC_URL     default http://127.0.0.1:8000/soroban/rpc
 *   HORIZON_URL         default http://127.0.0.1:8000
 *   QUICKSTART_RETRIES  default 15
 *   QUICKSTART_DELAY_MS default 2000
 */

import { pathToFileURL } from 'node:url';

export const DEFAULT_SOROBAN_RPC_URL = 'http://127.0.0.1:8000/soroban/rpc';
export const DEFAULT_HORIZON_URL = 'http://127.0.0.1:8000';
export const STANDALONE_PASSPHRASE = 'Standalone Network ; February 2017';

/**
 * Queries Soroban JSON-RPC `getHealth` once and returns normalized health data.
 */
export async function probeSorobanRpcHealth(
  rpcUrl = DEFAULT_SOROBAN_RPC_URL,
  fetchImpl = globalThis.fetch
) {
  const response = await fetchImpl(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getHealth',
    }),
  });

  if (!response.ok) {
    throw new Error(`Soroban RPC HTTP ${response.status}`);
  }

  const payload = await response.json();
  const result = payload?.result;
  if (!result || result.status !== 'healthy') {
    throw new Error(
      `Soroban RPC status is "${result?.status ?? 'unknown'}" (expected "healthy")`
    );
  }

  const latestLedger = Number(result.latestLedger ?? 0);
  if (!Number.isFinite(latestLedger) || latestLedger < 1) {
    throw new Error(`Soroban RPC latestLedger not ready (${result.latestLedger})`);
  }

  return {
    status: result.status,
    latestLedger,
    oldestLedger: Number(result.oldestLedger ?? 1),
    ledgerRetentionWindow: Number(result.ledgerRetentionWindow ?? 0),
  };
}

/**
 * Queries Horizon root endpoint once and confirms network passphrase & core version.
 */
export async function probeHorizonHealth(
  horizonUrl = DEFAULT_HORIZON_URL,
  fetchImpl = globalThis.fetch
) {
  const response = await fetchImpl(horizonUrl, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Horizon HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (!payload?.network_passphrase) {
    throw new Error('Horizon root response missing network_passphrase');
  }

  return {
    networkPassphrase: payload.network_passphrase,
    historyLatestLedger: Number(payload.history_latest_ledger ?? 0),
    coreLatestLedger: Number(payload.core_latest_ledger ?? 0),
  };
}

/**
 * Polls Soroban RPC and Horizon until both report healthy or `maxRetries` is exhausted.
 */
export async function verifyQuickstartRpcHealth(options = {}) {
  const rpcUrl = options.rpcUrl ?? process.env.SOROBAN_RPC_URL ?? DEFAULT_SOROBAN_RPC_URL;
  const horizonUrl = options.horizonUrl ?? process.env.HORIZON_URL ?? DEFAULT_HORIZON_URL;
  const maxRetries = Math.max(
    1,
    Number(options.maxRetries ?? process.env.QUICKSTART_RETRIES ?? 15)
  );
  const delayMs = Math.max(
    0,
    Number(options.delayMs ?? process.env.QUICKSTART_DELAY_MS ?? 2000)
  );
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const sleepFn =
    options.sleepFn ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const [soroban, horizon] = await Promise.all([
        probeSorobanRpcHealth(rpcUrl, fetchImpl),
        probeHorizonHealth(horizonUrl, fetchImpl),
      ]);

      return {
        healthy: true,
        attempts: attempt,
        rpcUrl,
        horizonUrl,
        soroban,
        horizon,
      };
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await sleepFn(delayMs);
      }
    }
  }

  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `Standalone Stellar quickstart failed health verification after ${maxRetries} attempts: ${reason}`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyQuickstartRpcHealth()
    .then((report) => {
      process.stdout.write(
        `[stellar-quickstart] HEALTHY after ${report.attempts} attempt(s): latestLedger=${report.soroban.latestLedger} network="${report.horizon.networkPassphrase}"\n`
      );
    })
    .catch((err) => {
      process.stderr.write(`[stellar-quickstart] FAIL: ${err.message}\n`);
      process.exit(1);
    });
}
