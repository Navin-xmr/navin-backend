/**
 * #1082 — the legacy `src/services/stellar.service.ts` (Horizon manageData
 * shipment/escrow paths and `{ success: false }` returns) is retired. Chain
 * work goes through the ChainAdapter port + factory only. These guards fail if
 * the module, an import of it, or a swallowed-error return shape comes back.
 */
import { describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(process.cwd(), 'src');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [full] : [];
  });
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('legacy stellar.service retired (#1082)', () => {
  const files = sourceFiles(SRC).map(file => ({
    file: path.relative(process.cwd(), file),
    code: stripComments(fs.readFileSync(file, 'utf8')),
  }));

  it('the module no longer exists', () => {
    expect(fs.existsSync(path.join(SRC, 'services', 'stellar.service.ts'))).toBe(false);
  });

  it('nothing in src imports stellar.service', () => {
    const importers = files
      .filter(({ code }) => /(from\s+|import\(\s*)['"][^'"]*stellar\.service(\.js)?['"]/.test(code))
      .map(({ file }) => file);
    expect(importers).toEqual([]);
  });

  it('no source resolves a { success: false } failure instead of throwing', () => {
    const offenders = files
      .filter(({ code }) => /return\s*\{[^}]*\bsuccess\s*:\s*false\b/.test(code))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it('Horizon manageData is only used inside the simulated adapter', () => {
    const offenders = files
      .filter(({ file }) => !file.endsWith(path.join('chain', 'simulated.adapter.ts')))
      .filter(({ code }) => /\bOperation\.manageData\b/.test(code))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
