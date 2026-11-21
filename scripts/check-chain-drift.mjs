#!/usr/bin/env node
/**
 * #1080 — fail the build when the chain interface drifts:
 *   (a) vendored ABI checksum matches contracts/abi/navin-escrow.abi.sha256
 *   (b) CHAIN_SPEC_VERSION matches the ABI and every tests/fixtures/chain/*.json `spec_version`
 *   (c) every function in CHAIN_FUNCTIONS (src/shared/types/chain.ts) exists in the ABI
 *
 * After a deliberate ABI update, refresh the checksum:
 *   sha256sum contracts/abi/navin-escrow.abi.json | cut -d' ' -f1 > contracts/abi/navin-escrow.abi.sha256
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function checkChainDrift(root = process.cwd()) {
  const errors = [];
  const read = rel => readFileSync(path.join(root, rel), 'utf8');

  const abiPath = 'contracts/abi/navin-escrow.abi.json';
  const abiRaw = readFileSync(path.join(root, abiPath));
  const abi = JSON.parse(abiRaw.toString('utf8'));

  const actual = createHash('sha256').update(abiRaw).digest('hex');
  const expected = read('contracts/abi/navin-escrow.abi.sha256').trim();
  if (actual !== expected) {
    errors.push(`ABI checksum drift: ${abiPath} is ${actual}, recorded ${expected}`);
  }

  const chainTs = read('src/shared/types/chain.ts');
  const specMatch = chainTs.match(/CHAIN_SPEC_VERSION\s*=\s*'([^']+)'/);
  const specVersion = specMatch?.[1];
  if (!specVersion) {
    errors.push('Could not find CHAIN_SPEC_VERSION in src/shared/types/chain.ts');
  } else {
    if (abi.spec_version !== specVersion) {
      errors.push(`ABI spec_version ${abi.spec_version} != CHAIN_SPEC_VERSION ${specVersion}`);
    }
    const fixtureDir = 'tests/fixtures/chain';
    for (const file of readdirSync(path.join(root, fixtureDir)).filter(f => f.endsWith('.json'))) {
      const fixture = JSON.parse(read(`${fixtureDir}/${file}`));
      if (fixture.spec_version !== specVersion) {
        errors.push(
          `${fixtureDir}/${file} spec_version ${fixture.spec_version} != CHAIN_SPEC_VERSION ${specVersion}`
        );
      }
    }
  }

  const fnMatch = chainTs.match(/CHAIN_FUNCTIONS\s*=\s*\[([^\]]*)\]/);
  if (!fnMatch) {
    errors.push('Could not find CHAIN_FUNCTIONS in src/shared/types/chain.ts');
  } else {
    const names = [...fnMatch[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
    for (const name of names) {
      if (!abi.functions || !(name in abi.functions)) {
        errors.push(`chain.ts function "${name}" is missing from the vendored ABI`);
      }
    }
  }

  return errors;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const errors = checkChainDrift();
  if (errors.length) {
    console.error('Chain drift detected:\n' + errors.map(e => `  - ${e}`).join('\n'));
    process.exit(1);
  }
  console.log('Chain ABI / spec version / fixtures are in sync.');
}
