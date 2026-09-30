import { describe, it, expect, jest } from '@jest/globals';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Run src/env.ts directly through tsx (rather than raw `node -e "import '../env.js'"`)
// so this works against TypeScript source with no build step — a plain Node child
// process has no `.ts` support and no `.js`→`.ts` resolution, so the previous
// `-e` approach could never actually resolve regardless of cwd.
const require = createRequire(import.meta.url);
const tsxCliPath = require.resolve('tsx/cli');
const testDir = path.dirname(fileURLToPath(import.meta.url));
const envEntryPath = path.resolve(testDir, '..', 'env.ts');

function runWithEnv(
  extra: Record<string, string> = {}
): Promise<{ code: number | null; output: string }> {
  const baseEnv: Record<string, string> = {
    NODE_ENV: 'test',
    PORT: '3000',
    MONGO_URI: 'mongodb://127.0.0.1:27017/navin_test',
    JWT_SECRET: 'a-very-long-test-secret-that-is-32-chars',
    REDIS_URL: 'redis://127.0.0.1:6379',
    STELLAR_NETWORK: 'testnet',
    ...extra,
  };

  return new Promise(resolve => {
    const child = spawn(process.execPath, [tsxCliPath, envEntryPath], {
      env: { ...process.env, ...baseEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
    });

    // env.ts logs its validation errors through pino, which writes to stdout —
    // capture both streams so assertions can check either.
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });

    child.on('close', code => {
      resolve({ code, output });
    });

    child.on('error', () => {
      resolve({ code: 1, output });
    });
  });
}

describe('env validation', () => {
  it('succeeds with all required vars present', async () => {
    const { code } = await runWithEnv();
    expect(code).toBe(0);
  });

  it('fails when MONGO_URI is missing', async () => {
    const { code } = await runWithEnv({ MONGO_URI: '' });
    expect(code).not.toBe(0);
  });

  it('fails when JWT_SECRET is missing', async () => {
    const { code } = await runWithEnv({ JWT_SECRET: '' });
    expect(code).not.toBe(0);
  });

  it('accepts optional vars without error', async () => {
    const { code } = await runWithEnv({
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '587',
      TWILIO_SID: 'AC123',
      S3_BUCKET: 'my-bucket',
      SENTRY_DSN: 'https://examplePublicKey@o0.ingest.sentry.io/0',
      FRONTEND_URL: 'http://localhost:5173',
    });
    expect(code).toBe(0);
  });

  it('rejects invalid URL for SENTRY_DSN', async () => {
    const { code } = await runWithEnv({ SENTRY_DSN: 'not-a-url' });
    expect(code).not.toBe(0);
  });

  it('rejects invalid URL for FRONTEND_URL', async () => {
    const { code } = await runWithEnv({ FRONTEND_URL: 'not-a-url' });
    expect(code).not.toBe(0);
  });

  it('fails fast when STELLAR_NETWORK is not testnet or public', async () => {
    const { code, output } = await runWithEnv({ STELLAR_NETWORK: 'devnet' });
    expect(code).not.toBe(0);
    expect(output).toContain('STELLAR_NETWORK');
  });

  it('accepts an explicit HORIZON_URL override', async () => {
    const { code } = await runWithEnv({ HORIZON_URL: 'https://horizon.example.com' });
    expect(code).toBe(0);
  });

  it('rejects an invalid HORIZON_URL', async () => {
    const { code } = await runWithEnv({ HORIZON_URL: 'not-a-url' });
    expect(code).not.toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Email-service mock factory import-surface check (issue #751)
//
// Shared factory: createEmailServiceMock in tests/helpers/mocks.ts. It must
// expose every named export that tested consumers import from the production
// email module. A missing export
// (e.g. `resetPasswordEmailHtml`) previously only surfaced when the full suite
// tried to import the service, producing a confusing failure far from the
// cause. This check fails fast with a clear message instead.
//
// It runs entirely in-process against the factory module: no email is sent and
// no secrets are read.
//
// Supported override pattern for tests:
//   const email = createEmailServiceMock({ sendEmail: jest.fn() });
//   // any named export can be overridden by passing it in the overrides object;
//   // unspecified exports fall back to the factory defaults.
// ---------------------------------------------------------------------------

describe('email-service mock factory import surface', () => {
  it('exposes every runtime export of the production email module', async () => {
    // Compare the factory against the real module runtime exports so a renamed
    // or added production export fails here with a clear message instead of
    // surfacing later as a confusing ESM import error in a consumer suite.
    // Fully in-process: no email is sent and no secrets are read.
    const [production, helpers] = await Promise.all([
      import('../services/email.service.js'),
      import('../../tests/helpers/mocks.js'),
    ]);

    const mock = helpers.createEmailServiceMock() as unknown as Record<string, unknown>;
    const missing = Object.keys(production).filter(name => !(name in mock));

    expect(missing).toEqual([]);
    if (missing.length > 0) {
      throw new Error(
        `email-service mock factory is missing named export(s): ${missing.join(
          ', '
        )}. Add them to createEmailServiceMock in tests/helpers/mocks.ts.`
      );
    }
  });

  it('supports overriding named exports for tests', async () => {
    const { createEmailServiceMock } = await import('../../tests/helpers/mocks.js');

    expect(typeof createEmailServiceMock).toBe('function');

    const override = jest.fn(() => 'overridden');
    const mock = createEmailServiceMock({ sendEmail: override });

    expect(mock.sendEmail).toBe(override);
  });
});
