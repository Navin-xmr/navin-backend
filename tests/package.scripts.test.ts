import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from '@jest/globals';

describe('package.json test scripts configuration (P9-06 / #917)', () => {
  const pkgPath = resolve(process.cwd(), 'package.json');
  const rawPkg = readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(rawPkg) as {
    scripts?: Record<string, string>;
  };

  it('does not contain duplicate test or test:watch keys in scripts', () => {
    const scriptsBlockMatch = rawPkg.match(/"scripts"\s*:\s*\{([\s\S]*?)\}/);
    expect(scriptsBlockMatch).not.toBeNull();

    const keys = [...scriptsBlockMatch![1].matchAll(/^\s*"([^"]+)"\s*:/gm)].map((m) => m[1]);
    const occurrences = keys.reduce<Record<string, number>>((acc, key) => {
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});

    expect(occurrences['test']).toBe(1);
    expect(occurrences['test:watch']).toBe(1);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('retains --max-old-space-size=4096 on both test and test:watch scripts', () => {
    expect(pkg.scripts?.['test']).toBe(
      'node --experimental-vm-modules --max-old-space-size=4096 node_modules/jest/bin/jest.js'
    );
    expect(pkg.scripts?.['test:watch']).toBe(
      'node --experimental-vm-modules --max-old-space-size=4096 node_modules/jest/bin/jest.js --watch'
    );
  });
});
