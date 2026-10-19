import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

const repoRoot = process.cwd();
const preCommitPath = path.join(repoRoot, '.husky', 'pre-commit');
const contributingPath = path.join(repoRoot, 'CONTRIBUTING.md');
const packageJsonPath = path.join(repoRoot, 'package.json');

describe('.husky/pre-commit hook wiring (#819)', () => {
  it('exists at .husky/pre-commit and invokes npx lint-staged', () => {
    expect(fs.existsSync(preCommitPath)).toBe(true);
    const content = fs.readFileSync(preCommitPath, 'utf8');
    expect(content).toContain('npx lint-staged');
  });

  it('is tracked in git with executable permission mode (100755)', () => {
    const lsFilesOutput = execFileSync('git', ['ls-files', '-s', '.husky/pre-commit'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();
    expect(lsFilesOutput.startsWith('100755 ')).toBe(true);
  });

  it('configures husky prepare script and lint-staged rules in package.json', () => {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
      scripts?: Record<string, string>;
      'lint-staged'?: Record<string, string[]>;
    };
    expect(pkg.scripts?.prepare).toContain('husky');
    expect(pkg['lint-staged']).toBeDefined();
  });

  it('documents the pre-commit hook verification steps in CONTRIBUTING.md', () => {
    const contributing = fs.readFileSync(contributingPath, 'utf8');
    expect(contributing).toContain('chmod +x .husky/pre-commit');
    expect(contributing).toContain('git ls-files -s .husky/pre-commit');
    expect(contributing).toContain('npx lint-staged');
  });
});
