#!/usr/bin/env node
/**
 * #996 — verify docs/chain-interface.md against the vendored shipment ABI.
 * Fails when a documented function is missing from the schema JSON (or vice versa).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function checkChainInterface(root = process.cwd()) {
  const read = rel => readFileSync(path.join(root, rel), 'utf8');
  const schema = JSON.parse(read('contracts/abi/contract-schema.shipment.json'));
  const abiNames = new Set(schema.map(entry => entry.function_v0?.name).filter(Boolean));

  const doc = read('docs/chain-interface.md');
  const section = doc.split('## 1. Functions')[1]?.split('## 2. Events')[0] ?? '';
  const documented = new Set(
    [...section.matchAll(/^\| `([a-z0-9_]+)` \|/gm)].map(match => match[1])
  );

  const errors = [];
  for (const name of documented) {
    if (!abiNames.has(name)) errors.push(`documented function "${name}" is not in the shipment ABI`);
  }
  for (const name of abiNames) {
    if (!documented.has(name)) errors.push(`ABI function "${name}" is not documented`);
  }
  return errors;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const errors = checkChainInterface();
  if (errors.length) {
    console.error('Chain interface drift:\n' + errors.map(error => `  - ${error}`).join('\n'));
    process.exit(1);
  }
  console.log('chain-interface.md matches the shipment ABI.');
}
