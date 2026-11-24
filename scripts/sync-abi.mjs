#!/usr/bin/env node
/**
 * scripts/sync-abi.mjs (P11-02)
 *
 * Verifies and refreshes vendored contract ABIs and schemas against pinned
 * navin-contracts source and recorded SHA-256 checksums.
 *
 * Usage:
 *   node scripts/sync-abi.mjs [--verify | --refresh]
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const VENDORED_FILES = [
  {
    schemaPath: 'contracts/abi/navin-escrow.abi.json',
    checksumPath: 'contracts/abi/navin-escrow.abi.sha256',
  },
  {
    schemaPath: 'docs/abi/contract-schema.shipment.json',
    checksumPath: 'docs/abi/contract-schema.shipment.sha256',
  },
];

export function computeSha256(contentBuffer) {
  const normalized = Buffer.from(contentBuffer.toString('utf8').replace(/\r\n/g, '\n'));
  return createHash('sha256').update(normalized).digest('hex');
}

export function verifyVendoredAbis(root = process.cwd()) {
  const errors = [];
  const results = [];

  for (const item of VENDORED_FILES) {
    const fullSchemaPath = path.join(root, item.schemaPath);
    const fullChecksumPath = path.join(root, item.checksumPath);

    if (!existsSync(fullSchemaPath)) {
      errors.push(`Missing ABI file: ${item.schemaPath}`);
      continue;
    }
    if (!existsSync(fullChecksumPath)) {
      errors.push(`Missing checksum file: ${item.checksumPath}`);
      continue;
    }

    const schemaContent = readFileSync(fullSchemaPath);
    const actualChecksum = computeSha256(schemaContent);
    const expectedChecksum = readFileSync(fullChecksumPath, 'utf8').trim();

    if (actualChecksum !== expectedChecksum) {
      errors.push(
        `Checksum drift for ${item.schemaPath}: actual ${actualChecksum} does not match recorded ${expectedChecksum}`
      );
    } else {
      results.push({ file: item.schemaPath, checksum: actualChecksum, valid: true });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    results,
  };
}

export function refreshVendoredAbis(root = process.cwd()) {
  const updated = [];
  for (const item of VENDORED_FILES) {
    const fullSchemaPath = path.join(root, item.schemaPath);
    const fullChecksumPath = path.join(root, item.checksumPath);

    if (!existsSync(fullSchemaPath)) {
      throw new Error(`Cannot refresh missing schema file: ${item.schemaPath}`);
    }

    const schemaContent = readFileSync(fullSchemaPath);
    const checksum = computeSha256(schemaContent);
    writeFileSync(fullChecksumPath, `${checksum}\n`, 'utf8');
    updated.push({ file: item.schemaPath, checksum });
  }
  return updated;
}

// CLI entrypoint
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const isRefresh = process.argv.includes('--refresh');

  if (isRefresh) {
    try {
      const refreshed = refreshVendoredAbis();
      console.log('Successfully refreshed vendored ABI checksums:');
      for (const item of refreshed) {
        console.log(` - ${item.file}: ${item.checksum}`);
      }
      process.exit(0);
    } catch (err) {
      console.error('Failed to refresh ABI checksums:', err.message);
      process.exit(1);
    }
  } else {
    // Default or --verify
    const result = verifyVendoredAbis();
    if (!result.valid) {
      console.error('❌ ABI Checksum Drift Verification FAILED:');
      for (const err of result.errors) {
        console.error(`  - ${err}`);
      }
      console.error('\nRun `npm run sync:abi -- --refresh` after an intentional ABI update.');
      process.exit(1);
    } else {
      console.log('✅ All vendored ABI files match their recorded SHA-256 checksums:');
      for (const item of result.results) {
        console.log(` - ${item.file} [${item.checksum}]`);
      }
      process.exit(0);
    }
  }
}
