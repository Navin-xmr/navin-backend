import path from 'node:path';
import { ESLint } from 'eslint';

describe('ESLint no-restricted-imports for stellar.service.js in tests (P9-14 / #925)', () => {
  const eslint = new ESLint({
    overrideConfigFile: path.resolve(process.cwd(), 'eslint.config.js'),
  });

  it('rejects direct stellar.service.js imports in top-level test files', async () => {
    const code = `import { tokenizeShipment } from '../src/services/stellar.service.js';\nexport const ref = tokenizeShipment;\n`;
    const [result] = await eslint.lintText(code, {
      filePath: path.resolve(process.cwd(), 'tests/shipments.test.ts'),
    });

    const restrictedErrors = result.messages.filter(
      (msg) => msg.ruleId === 'no-restricted-imports',
    );
    expect(restrictedErrors).toHaveLength(1);
    expect(restrictedErrors[0]?.message).toContain('Do not import stellar.service.js directly');
  });

  it('rejects direct stellar.service.js imports in nested test subdirectories', async () => {
    const code = `import { releaseEscrow } from '../../src/services/stellar.service.js';\nexport const ref = releaseEscrow;\n`;
    const [result] = await eslint.lintText(code, {
      filePath: path.resolve(process.cwd(), 'tests/e2e/core-flow.test.ts'),
    });

    const restrictedErrors = result.messages.filter(
      (msg) => msg.ruleId === 'no-restricted-imports',
    );
    expect(restrictedErrors).toHaveLength(1);
  });

  it('allows direct stellar.service.js imports inside tests/stellar.service.test.ts', async () => {
    const code = `import { tokenizeShipment } from '../src/services/stellar.service.js';\nexport const ref = tokenizeShipment;\n`;
    const [result] = await eslint.lintText(code, {
      filePath: path.resolve(process.cwd(), 'tests/stellar.service.test.ts'),
    });

    const restrictedErrors = result.messages.filter(
      (msg) => msg.ruleId === 'no-restricted-imports',
    );
    expect(restrictedErrors).toHaveLength(0);
  });

  it('allows importing port mock helpers in tests', async () => {
    const code = `import { createChainAdapterMock } from './helpers/mocks.js';\nexport const ref = createChainAdapterMock;\n`;
    const [result] = await eslint.lintText(code, {
      filePath: path.resolve(process.cwd(), 'tests/shipments.test.ts'),
    });

    const restrictedErrors = result.messages.filter(
      (msg) => msg.ruleId === 'no-restricted-imports',
    );
    expect(restrictedErrors).toHaveLength(0);
  });
});
