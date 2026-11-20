import { describe, expect, it } from '@jest/globals';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/** Secret patterns that must never be committed in source or test snapshots. */
const SECRET_PATTERNS: RegExp[] = [
  /sk_live_[0-9A-Za-z]{24,}/, // Stripe live secret key
  /sk_test_[0-9A-Za-z]{24,}/, // Stripe test secret key
  /AKIA[0-9A-Z]{16}/, // AWS access key id
  /-----BEGIN (RSA |EC |DSA |ENCRYPTED PRIVATE |PRIVATE )?KEY-----/, // PEM private key
  /STELLAR_SECRET_KEY\s*=\s*["'][^"']*["']/, // hardcoded Stellar secret assignment
  /["']S[A-Z2-7]{56,}["']/, // raw Stellar secret literal (seed is 56 chars)
];

/** Files intentionally excluded from the scan (documented in docs/security/signer-key-review.md). */
const EXCLUDED = new Set([
  'tests/secret-scanning.test.ts', // this file carries the patterns themselves
  'tests/soroban.adapter.test.ts', // intentional sample (non-production) key fixture
]);

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFiles(full));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.snap')) {
      out.push(full);
    }
  }
  return out;
}

describe('secret scanning', () => {
  it('no hardcoded secrets in source code or test snapshots', () => {
    const files = [...collectFiles(join(ROOT, 'src')), ...collectFiles(join(ROOT, 'tests'))].filter(
      file => {
        const rel = file
          .slice(ROOT.length)
          .replace(/^[\\/]+/, '')
          .replace(/\\/g, '/');
        return !EXCLUDED.has(rel);
      }
    );

    const hits: Array<{ file: string; line: number; pattern: string }> = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        for (const pattern of SECRET_PATTERNS) {
          if (pattern.test(lines[i])) {
            hits.push({ file, line: i + 1, pattern: pattern.source });
          }
        }
      }
    }

    // Grep evidence: hits are reported in the assertion diff on failure.
    expect(hits).toEqual([]);
  });
});
