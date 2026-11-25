/**
 * Tests for P11-02 — Vendored ABI verification and sync script.
 *
 * Requirements:
 *  1. Clean vendored ABI files pass SHA-256 checksum verification.
 *  2. Tampered ABI file fails verification and reports the drift.
 */

import { describe, it, expect } from '@jest/globals';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  verifyVendoredAbis,
  computeSha256,
} from '../scripts/sync-abi.mjs';

describe('P11-02 — ABI vendoring verification (sync-abi)', () => {
  it('clean vendored ABI files pass verification against the repository root', () => {
    const result = verifyVendoredAbis(process.cwd());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.results.length).toBeGreaterThanOrEqual(2);
  });

  it('detects tampering and fails when an ABI file does not match its recorded checksum', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'abi-tamper-test-'));

    try {
      // Recreate folder structure in tempDir
      mkdirSync(path.join(tempDir, 'contracts', 'abi'), { recursive: true });
      mkdirSync(path.join(tempDir, 'docs', 'abi'), { recursive: true });

      const genuineContent = Buffer.from('{"spec_version":"2.1.0","genuine":true}');
      const genuineChecksum = computeSha256(genuineContent);

      const tamperedContent = Buffer.from('{"spec_version":"2.1.0","tampered":true}');

      // Setup contracts/abi
      writeFileSync(
        path.join(tempDir, 'contracts', 'abi', 'navin-escrow.abi.json'),
        genuineContent
      );
      writeFileSync(
        path.join(tempDir, 'contracts', 'abi', 'navin-escrow.abi.sha256'),
        `${genuineChecksum}\n`
      );

      // Setup docs/abi with TAMPERED content
      writeFileSync(
        path.join(tempDir, 'docs', 'abi', 'contract-schema.shipment.json'),
        tamperedContent
      );
      writeFileSync(
        path.join(tempDir, 'docs', 'abi', 'contract-schema.shipment.sha256'),
        `${genuineChecksum}\n`
      );

      const result = verifyVendoredAbis(tempDir);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
      expect(result.errors[0]).toMatch(/Checksum drift for docs\/abi\/contract-schema\.shipment\.json/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('fails with an actionable message when an ABI file or checksum file is missing', () => {
    const emptyTempDir = mkdtempSync(path.join(tmpdir(), 'abi-missing-test-'));
    try {
      const result = verifyVendoredAbis(emptyTempDir);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Missing ABI file'))).toBe(true);
    } finally {
      rmSync(emptyTempDir, { recursive: true, force: true });
    }
  });
});
