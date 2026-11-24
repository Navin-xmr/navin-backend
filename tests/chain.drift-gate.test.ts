import { describe, expect, it, afterEach } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error plain ESM script without types
import { checkChainDrift } from '../scripts/check-chain-drift.mjs';

const copies: string[] = [];
function copyRepoSubset(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-drift-'));
  copies.push(dir);
  for (const rel of ['contracts/abi', 'tests/fixtures/chain', 'src/shared/types']) {
    fs.cpSync(path.join(process.cwd(), rel), path.join(dir, rel), { recursive: true });
  }
  return dir;
}

afterEach(() => {
  for (const d of copies.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('chain drift gate (#1080)', () => {
  it('is green on the committed tree', () => {
    expect(checkChainDrift(process.cwd())).toEqual([]);
  });

  it('fails on ABI checksum drift', () => {
    const dir = copyRepoSubset();
    const abiFile = path.join(dir, 'contracts/abi/navin-escrow.abi.json');
    fs.writeFileSync(abiFile, fs.readFileSync(abiFile, 'utf8') + '\n');
    expect(checkChainDrift(dir).join('\n')).toMatch(/ABI checksum drift/);
  });

  it('fails when a fixture spec_version drifts', () => {
    const dir = copyRepoSubset();
    const f = path.join(dir, 'tests/fixtures/chain/errors.json');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('"2.1.0"', '"9.9.9"'));
    expect(checkChainDrift(dir).join('\n')).toMatch(/errors\.json spec_version 9\.9\.9/);
  });

  it('fails when chain.ts names a function missing from the ABI', () => {
    const dir = copyRepoSubset();
    const f = path.join(dir, 'src/shared/types/chain.ts');
    fs.writeFileSync(
      f,
      fs
        .readFileSync(f, 'utf8')
        .replace(/'update_status',[\r\n]+\] as const/, "'update_status', 'refund'] as const")
    );
    expect(checkChainDrift(dir).join('\n')).toMatch(/"refund" is missing/);
  });
});
