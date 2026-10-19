import fs from 'node:fs';
import path from 'node:path';
import * as loggerModule from '../logger.js';
import { logger } from '../logger.js';

function collectTsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTsFiles(fullPath, acc);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      acc.push(fullPath);
    }
  }
  return acc;
}

describe('Standardized logger exports (#816)', () => {
  it('exports named `logger` singleton and omits `default` export', () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');
    expect('default' in loggerModule).toBe(false);
  });

  it('enforces named `import { logger }` across all call sites in src/', () => {
    const srcRoot = path.resolve(process.cwd(), 'src');
    const files = collectTsFiles(srcRoot);
    const defaultImportRegex =
      /^\s*import\s+logger(?:\s*,|\s+from)\s+['"][^'"]*shared\/logger\/logger(?:\.js)?['"]/m;

    const offendingFiles: string[] = [];
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      if (defaultImportRegex.test(content)) {
        offendingFiles.push(path.relative(srcRoot, file));
      }
    }

    expect(offendingFiles).toEqual([]);
  });
});
