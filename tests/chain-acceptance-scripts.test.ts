import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateDataHash } from '../src/shared/utils/crypto.js';
import {
  computeCanonicalSha256,
  runSimulatedAcceptance,
} from '../scripts/acceptance/run-simulated.mjs';
import { runSorobanAcceptance } from '../scripts/acceptance/run-soroban.mjs';

describe('scripts/acceptance/ chain acceptance scripts (#847)', () => {
  it('runs the full simulated acceptance lifecycle and verifies sha256(canonicalPayload) === dataHash', async () => {
    process.env.SOROBAN_ADAPTER = 'simulated';
    const logs: string[] = [];
    const result = await runSimulatedAcceptance({ log: msg => logs.push(msg) });

    expect(result.adapter).toBe('simulated');
    expect(result.verified).toBe(true);
    expect(result.recomputedHash).toBe(result.dataHash);
    expect(logs.some(line => line.includes('Step 1 OK: Created shipment'))).toBe(true);
    expect(logs.some(line => line.includes('Step 2 OK: Anchored'))).toBe(true);
    expect(logs.some(line => line.includes('Step 4: Fetching GET /api/ledger/blocks/'))).toBe(true);
    expect(logs.some(line => line.includes('Step 5 OK: sha256(canonicalPayload) === dataHash'))).toBe(
      true
    );
  });

  it('runs the full soroban acceptance lifecycle and verifies sha256(canonicalPayload) === dataHash', async () => {
    const logs: string[] = [];
    const result = await runSorobanAcceptance({ log: msg => logs.push(msg) });

    expect(process.env.SOROBAN_ADAPTER).toBe('soroban');
    expect(result.adapter).toBe('soroban');
    expect(result.verified).toBe(true);
    expect(result.recomputedHash).toBe(result.dataHash);
    expect(logs.some(line => line.includes('Step 5 OK: sha256(canonicalPayload) === dataHash'))).toBe(
      true
    );
  });

  it('fails when sha256(canonicalPayload) !== dataHash in both acceptance scripts', async () => {
    process.env.SOROBAN_ADAPTER = 'simulated';
    await expect(
      runSimulatedAcceptance({ tamperHash: true, log: () => undefined })
    ).rejects.toThrow(/Hash mismatch: sha256\(canonicalPayload\)=.* !== dataHash=/);

    await expect(
      runSorobanAcceptance({ tamperHash: true, log: () => undefined })
    ).rejects.toThrow(/Hash mismatch: sha256\(canonicalPayload\)=.* !== dataHash=/);
  });

  it('produces identical SHA-256 digests to generateDataHash in src/shared/utils/crypto.ts and is documented in docs/blockchain.md', () => {
    const samplePayload = {
      v: 1,
      shipmentId: '65f1a2b3c4d5e6f708192a3b',
      event: 'IN_TRANSIT',
      actor: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      timestamp: '2026-01-15T10:00:00.000Z',
      metadata: { temperature: 4.2, unit: 'C' },
    };
    expect(computeCanonicalSha256(samplePayload)).toBe(generateDataHash(samplePayload));

    const blockchainDoc = readFileSync(resolve(process.cwd(), 'docs/blockchain.md'), 'utf8');
    expect(blockchainDoc).toContain('scripts/acceptance/run-simulated.mjs');
    expect(blockchainDoc).toContain('scripts/acceptance/run-soroban.mjs');
  });
});
