import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SCHEMA_PATH = path.resolve(process.cwd(), 'src/env.schema.ts');
const DOCS_PATH = path.resolve(process.cwd(), 'docs/environment-variables.md');

describe('docs/environment-variables.md 1-to-1 parity with src/env.schema.ts (#855)', () => {
  const schemaSource = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const docsContent = fs.readFileSync(DOCS_PATH, 'utf8');

  it('documents every Zod-validated environment variable defined in src/env.schema.ts', () => {
    const matches = [...schemaSource.matchAll(/^\s*([A-Z][A-Z0-9_]+):\s*z\b/gm)];
    const schemaKeys = matches.map(m => m[1]);
    expect(schemaKeys.length).toBeGreaterThanOrEqual(25);

    for (const key of schemaKeys) {
      expect(docsContent, `Missing ${key} in docs/environment-variables.md`).toContain(
        `\`${key}\``
      );
    }
  });

  it('documents STORAGE_PROVIDER, CLOUDINARY_*, TOTP_ENCRYPTION_KEY, and Soroban superRefine rules', () => {
    expect(docsContent).toContain('`STORAGE_PROVIDER`');
    expect(docsContent).toContain('`CLOUDINARY_CLOUD_NAME`');
    expect(docsContent).toContain('`CLOUDINARY_API_KEY`');
    expect(docsContent).toContain('`CLOUDINARY_API_SECRET`');
    expect(docsContent).toContain('`TOTP_ENCRYPTION_KEY`');
    expect(docsContent).toContain('`SOROBAN_RPC_URL`');
    expect(docsContent).toContain('`ESCROW_CONTRACT_ID`');
    expect(docsContent).toContain('superRefine');
  });
});
