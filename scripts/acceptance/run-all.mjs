#!/usr/bin/env node
/**
 * Master runner for all four chain conformance acceptance scenarios (Issue #807).
 */

import { pathToFileURL } from 'node:url';
import { runScenario1 } from './01-scan-to-anchored.mjs';
import { runScenario2 } from './02-deliver-to-escrow-released.mjs';
import { runScenario3 } from './03-indexer-ingests-emitted-event.mjs';
import { runScenario4 } from './04-frontend-verifies-badge-via-bundle.mjs';

export async function runAllAcceptanceScenarios() {
  const runners = [
    { name: '01-scan-to-anchored', fn: runScenario1 },
    { name: '02-deliver-to-escrow-released', fn: runScenario2 },
    { name: '03-indexer-ingests-emitted-event', fn: runScenario3 },
    { name: '04-frontend-verifies-badge-via-bundle', fn: runScenario4 },
  ];

  const results = [];
  for (const { name, fn } of runners) {
    try {
      const res = await fn();
      results.push(res);
      process.stdout.write(`[PASS] ${name}\n`);
    } catch (err) {
      results.push({
        scenario: name,
        passed: false,
        error: err instanceof Error ? err.message : String(err),
      });
      process.stderr.write(`[FAIL] ${name}: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  const passedCount = results.filter((r) => r.passed).length;
  return {
    total: runners.length,
    passedCount,
    failedCount: runners.length - passedCount,
    allPassed: passedCount === runners.length,
    results,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAllAcceptanceScenarios()
    .then((summary) => {
      process.stdout.write(
        `\nChain Conformance Summary: ${summary.passedCount}/${summary.total} scenarios PASSED.\n`
      );
      if (!summary.allPassed) {
        process.exit(1);
      }
    })
    .catch((err) => {
      process.stderr.write(`Fatal acceptance runner error: ${err.message}\n`);
      process.exit(1);
    });
}
