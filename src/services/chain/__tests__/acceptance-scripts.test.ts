import { execFileSync } from 'node:child_process';
import path from 'node:path';

describe('Chain conformance acceptance scripts (#807)', () => {
  const acceptanceDir = path.resolve(process.cwd(), 'scripts', 'acceptance');

  it('executes all four chain conformance scenarios and reports 4/4 PASSED', () => {
    const output = execFileSync(process.execPath, [path.join(acceptanceDir, 'run-all.mjs')], {
      encoding: 'utf8',
    });

    expect(output).toContain('[PASS] 01-scan-to-anchored');
    expect(output).toContain('[PASS] 02-deliver-to-escrow-released');
    expect(output).toContain('[PASS] 03-indexer-ingests-emitted-event');
    expect(output).toContain('[PASS] 04-frontend-verifies-badge-via-bundle');
    expect(output).toContain('4/4 scenarios PASSED');
  });
});
