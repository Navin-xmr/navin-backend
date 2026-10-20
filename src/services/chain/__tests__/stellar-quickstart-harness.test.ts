import fs from 'node:fs';
import path from 'node:path';
import {
  probeSorobanRpcHealth,
  probeHorizonHealth,
  verifyQuickstartRpcHealth,
  STANDALONE_PASSPHRASE,
} from '../../../../scripts/stellar-quickstart-health.mjs';

describe('Standalone Stellar quickstart nightly harness (#806)', () => {
  it('configures stellar/quickstart standalone container in docker-compose files and docs', () => {
    const composeMain = fs.readFileSync(
      path.resolve(process.cwd(), 'docker-compose.yml'),
      'utf8'
    );
    const composeQuickstart = fs.readFileSync(
      path.resolve(process.cwd(), 'docker-compose.quickstart.yml'),
      'utf8'
    );
    const blockchainDocs = fs.readFileSync(
      path.resolve(process.cwd(), 'docs', 'blockchain.md'),
      'utf8'
    );

    expect(composeMain).toContain('stellar/quickstart:latest');
    expect(composeMain).toContain('--standalone');
    expect(composeMain).toContain('--enable-soroban-rpc');
    expect(composeQuickstart).toContain('http://stellar-quickstart:8000/soroban/rpc');
    expect(blockchainDocs).toContain('scripts/stellar-quickstart-health.mjs');
    expect(blockchainDocs).toContain(STANDALONE_PASSPHRASE);
  });

  it('probes Soroban RPC getHealth and Horizon root endpoints and retries until healthy', async () => {
    let rpcCallCount = 0;
    const mockFetch = async (url: string) => {
      if (String(url).includes('/soroban/rpc')) {
        rpcCallCount += 1;
        if (rpcCallCount < 2) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              jsonrpc: '2.0',
              id: 1,
              result: { status: 'starting', latestLedger: 0 },
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            jsonrpc: '2.0',
            id: 1,
            result: {
              status: 'healthy',
              latestLedger: 42,
              oldestLedger: 1,
              ledgerRetentionWindow: 17280,
            },
          }),
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          network_passphrase: STANDALONE_PASSPHRASE,
          history_latest_ledger: 42,
          core_latest_ledger: 42,
        }),
      };
    };

    const report = await verifyQuickstartRpcHealth({
      rpcUrl: 'http://127.0.0.1:8000/soroban/rpc',
      horizonUrl: 'http://127.0.0.1:8000',
      maxRetries: 4,
      delayMs: 0,
      fetchImpl: mockFetch,
      sleepFn: async () => undefined,
    });

    expect(report.healthy).toBe(true);
    expect(report.attempts).toBe(2);
    expect(report.soroban.latestLedger).toBe(42);
    expect(report.horizon.networkPassphrase).toBe(STANDALONE_PASSPHRASE);
  });

  it('throws descriptive error when standalone node does not become healthy within maxRetries', async () => {
    const failingFetch = async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    });

    await expect(
      verifyQuickstartRpcHealth({
        maxRetries: 2,
        delayMs: 0,
        fetchImpl: failingFetch,
        sleepFn: async () => undefined,
      })
    ).rejects.toThrow(/failed health verification after 2 attempts/);

    await expect(probeSorobanRpcHealth('http://127.0.0.1:8000/soroban/rpc', failingFetch)).rejects.toThrow(
      /Soroban RPC HTTP 503/
    );
    await expect(probeHorizonHealth('http://127.0.0.1:8000', failingFetch)).rejects.toThrow(
      /Horizon HTTP 503/
    );
  });
});
