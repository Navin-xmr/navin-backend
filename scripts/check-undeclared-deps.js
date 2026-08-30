#!/usr/bin/env node
/**
 * check-undeclared-deps.js
 *
 * Scans all runtime imports in src/ and verifies every bare-specifier package
 * is listed in package.json `dependencies`. Reports any packages that are
 * imported but not declared — catching issues like an accidentally-removed
 * entry or a package that only exists in a contributor's local node_modules.
 *
 * Usage:
 *   node scripts/check-undeclared-deps.js
 *   npm run check:deps
 *
 * Exit codes:
 *   0 — all imports are declared
 *   1 — one or more undeclared imports found
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const SRC_DIR = join(ROOT, 'src');
const PKG_PATH = join(ROOT, 'package.json');

// ── Load declared dependencies ────────────────────────────────────────────────
const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8'));
const declared = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  // devDependencies intentionally excluded — runtime imports must be in dependencies
]);
const declaredDev = new Set(Object.keys(pkg.devDependencies ?? {}));

// Test-only packages that are expected in src/**/__tests__/** or *.test.ts files
const isTestFile = (filePath) => filePath.includes('__tests__') || filePath.endsWith('.test.ts');

// Node.js built-in modules — never need to be in package.json
const BUILTINS = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
  'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain',
  'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net',
  'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring',
  'readline', 'repl', 'stream', 'string_decoder', 'sys', 'timers',
  'tls', 'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'worker_threads',
  'zlib',
]);

// ── Collect all .ts source files under src/ ───────────────────────────────────
function collectFiles(dir, results = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectFiles(full, results);
    } else if (['.ts', '.tsx'].includes(extname(entry))) {
      results.push(full);
    }
  }
  return results;
}

// ── Extract bare-specifier imports from source text ───────────────────────────
// Matches:
//   import ... from 'pkg'
//   import ... from "pkg"
//   import('pkg')
//   require('pkg')
//   export ... from 'pkg'
const IMPORT_RE =
  /(?:import|export)\s+(?:type\s+)?(?:[^'"]*from\s+)?['"]([^'"]+)['"]/g;
const DYNAMIC_RE = /(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function extractPackageNames(source) {
  const names = new Set();
  for (const re of [IMPORT_RE, DYNAMIC_RE]) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(source)) !== null) {
      const specifier = match[1];
      // Relative and absolute paths are not packages
      if (specifier.startsWith('.') || specifier.startsWith('/')) continue;
      // node: protocol builtins
      if (specifier.startsWith('node:')) continue;
      // Scoped package: @scope/name → root is @scope/name
      // Un-scoped package: pkg/sub/path → root is pkg
      const root = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : specifier.split('/')[0];
      names.add(root);
    }
  }
  return names;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const files = collectFiles(SRC_DIR);
const undeclared = new Set();

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  for (const pkg of extractPackageNames(source)) {
    if (BUILTINS.has(pkg) || declared.has(pkg)) continue;
    // Allow devDependencies in test files and for known test-infra in src/
    if (isTestFile(file) && declaredDev.has(pkg)) continue;
    // mongodb-memory-server is imported in src/infra/mongo/connection.ts for test/dev only
    if (pkg === 'mongodb-memory-server' && declaredDev.has(pkg)) continue;
    // @faker-js/faker is imported in src/scripts/seed.ts (dev seeding tool only)
    if (pkg === '@faker-js/faker' && declaredDev.has(pkg)) continue;
    undeclared.add(pkg);
    console.error(`  [UNDECLARED] "${pkg}" — imported in ${file.replace(ROOT + '/', '')}`);
  }
}

if (undeclared.size > 0) {
  console.error(
    `\n✖ ${undeclared.size} undeclared package(s) found. Add them to package.json "dependencies" and re-run npm ci.\n`
  );
  process.exit(1);
}

console.log(`✔ All imports match package.json dependencies (${files.length} files scanned).`);
