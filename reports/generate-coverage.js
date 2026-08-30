#!/usr/bin/env node
/**
 * API surface coverage generator.
 *
 * Parses docs/swagger.yaml and scans Express mounts + *.routes.ts handlers,
 * then writes reports/API_SURFACE_COVERAGE.html highlighting swagger ↔ code drift.
 *
 * Usage: node reports/generate-coverage.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yamljs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SWAGGER_PATH = path.join(ROOT, 'docs', 'swagger.yaml');
const APP_PATH = path.join(ROOT, 'src', 'app.ts');
const MODULES_DIR = path.join(ROOT, 'src', 'modules');
const OUT_PATH = path.join(ROOT, 'reports', 'API_SURFACE_COVERAGE.html');

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head']);

/**
 * Normalize Express `:id` / OpenAPI `{id}` path params to `{param}` form.
 * @param {string} p
 * @returns {string}
 */
function normalizePath(p) {
  return p
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}')
    .replace(/\/$/, '') || '/';
}

/**
 * Join mount prefix + route path into a full API path.
 * @param {string} mount
 * @param {string} routePath
 * @returns {string}
 */
function joinPaths(mount, routePath) {
  const base = mount.replace(/\/$/, '') || '';
  const rel = routePath === '/' ? '' : routePath;
  return normalizePath(`${base}${rel}` || '/');
}

/**
 * @returns {Map<string, Set<string>>} path → methods
 */
function parseSwaggerPaths() {
  const doc = YAML.load(SWAGGER_PATH);
  /** @type {Map<string, Set<string>>} */
  const map = new Map();
  const paths = doc?.paths ?? {};
  for (const [rawPath, item] of Object.entries(paths)) {
    const full = normalizePath(rawPath);
    if (!map.has(full)) map.set(full, new Set());
    for (const key of Object.keys(item ?? {})) {
      const method = key.toLowerCase();
      if (HTTP_METHODS.has(method)) {
        map.get(full).add(method.toUpperCase());
      }
    }
  }
  return map;
}

/**
 * Parse `app.use('/api/...', someRouter)` mounts from src/app.ts.
 * @returns {Array<{ mount: string, routerVar: string }>}
 */
function parseAppMounts() {
  const src = fs.readFileSync(APP_PATH, 'utf8');
  const mounts = [];
  const re = /app\.use\(\s*['"`]([^'"`]+)['"`]\s*,\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const mount = m[1];
    const routerVar = m[2];
    // Skip non-router middleware mounts (limiters, swagger, etc.)
    if (!/Router$/i.test(routerVar) && !/router$/i.test(routerVar)) continue;
    mounts.push({ mount, routerVar });
  }
  return mounts;
}

/**
 * Find which routes file exports a given router variable.
 * @param {string} routerVar
 * @returns {string | null}
 */
function findRoutesFileForRouter(routerVar) {
  const entries = walkFiles(MODULES_DIR, '.routes.ts');
  for (const file of entries) {
    const src = fs.readFileSync(file, 'utf8');
    const exportRe = new RegExp(
      `export\\s+(?:const|let|var)\\s+${routerVar}\\s*=\\s*Router\\s*\\(`
    );
    if (exportRe.test(src)) return file;
  }
  return null;
}

/**
 * @param {string} dir
 * @param {string} suffix
 * @returns {string[]}
 */
function walkFiles(dir, suffix) {
  /** @type {string[]} */
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full, suffix));
    else if (entry.name.endsWith(suffix)) out.push(full);
  }
  return out;
}

/**
 * Extract METHOD + path from a routes file for a given router variable.
 * @param {string} file
 * @param {string} routerVar
 * @returns {Array<{ method: string, path: string }>}
 */
function parseRouteHandlers(file, routerVar) {
  const src = fs.readFileSync(file, 'utf8');
  /** @type {Array<{ method: string, path: string }>} */
  const routes = [];
  const re = new RegExp(
    `${routerVar}\\.(get|post|put|patch|delete|options|head)\\(\\s*['"\`]([^'"\`]*)['"\`]`,
    'gi'
  );
  let m;
  while ((m = re.exec(src)) !== null) {
    routes.push({ method: m[1].toUpperCase(), path: m[2] || '/' });
  }
  return routes;
}

/**
 * Build the live route table from mounts + route handlers.
 * @returns {Map<string, Set<string>>}
 */
function parseCodeRoutes() {
  /** @type {Map<string, Set<string>>} */
  const map = new Map();
  const mounts = parseAppMounts();

  for (const { mount, routerVar } of mounts) {
    const file = findRoutesFileForRouter(routerVar);
    if (!file) {
      console.warn(`Warning: no routes file found for ${routerVar}`);
      continue;
    }
    for (const { method, path: routePath } of parseRouteHandlers(file, routerVar)) {
      const full = joinPaths(mount, routePath);
      if (!map.has(full)) map.set(full, new Set());
      map.get(full).add(method);
    }
  }
  return map;
}

/**
 * Also surface route handlers that exist in *.routes.ts but are never mounted.
 * @param {Map<string, Set<string>>} mounted
 * @returns {Array<{ path: string, method: string, file: string, note: string }>}
 */
function findUnmountedRouteFiles(mounted) {
  const mountedVars = new Set(parseAppMounts().map(m => m.routerVar));
  /** @type {Array<{ path: string, method: string, file: string, note: string }>} */
  const orphans = [];
  for (const file of walkFiles(MODULES_DIR, '.routes.ts')) {
    const src = fs.readFileSync(file, 'utf8');
    const exportMatch = src.match(/export\s+(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*Router\s*\(/);
    if (!exportMatch) continue;
    const routerVar = exportMatch[1];
    if (mountedVars.has(routerVar)) continue;
    // Infer a conventional mount from swagger-like module naming when possible
    const inferredMount = inferMountFromFile(file, routerVar);
    for (const { method, path: routePath } of parseRouteHandlers(file, routerVar)) {
      const full = joinPaths(inferredMount, routePath);
      orphans.push({
        path: full,
        method,
        file: path.relative(ROOT, file).replace(/\\/g, '/'),
        note: `Router ${routerVar} is defined but not mounted in src/app.ts`,
      });
      // Count as in-code so drift vs swagger is visible
      if (!mounted.has(full)) mounted.set(full, new Set());
      mounted.get(full).add(method);
    }
  }
  return orphans;
}

/**
 * @param {string} file
 * @param {string} routerVar
 * @returns {string}
 */
function inferMountFromFile(file, routerVar) {
  const rel = path.relative(MODULES_DIR, file).replace(/\\/g, '/');
  if (rel.startsWith('ledger/')) return '/api/ledger/blocks';
  const folder = rel.split('/')[0];
  return `/api/${folder}`;
}

/**
 * @typedef {{ path: string, method: string, inSwagger: boolean, inCode: boolean, status: string }} Row
 */

/**
 * @param {Map<string, Set<string>>} swagger
 * @param {Map<string, Set<string>>} code
 * @returns {Row[]}
 */
function diffRoutes(swagger, code) {
  /** @type {Set<string>} */
  const keys = new Set();
  for (const [p, methods] of swagger) {
    for (const m of methods) keys.add(`${m} ${p}`);
  }
  for (const [p, methods] of code) {
    for (const m of methods) keys.add(`${m} ${p}`);
  }

  /** @type {Row[]} */
  const rows = [];
  for (const key of [...keys].sort()) {
    const [method, ...rest] = key.split(' ');
    const p = rest.join(' ');
    const inSwagger = swagger.get(p)?.has(method) ?? false;
    const inCode = code.get(p)?.has(method) ?? false;
    let status = 'aligned';
    if (inSwagger && !inCode) status = 'swagger-only';
    else if (!inSwagger && inCode) status = 'code-only';
    rows.push({ path: p, method, inSwagger, inCode, status });
  }
  return rows;
}

/**
 * @param {Row[]} rows
 * @param {Array<{ path: string, method: string, file: string, note: string }>} orphans
 * @returns {string}
 */
function renderHtml(rows, orphans) {
  const generatedAt = new Date().toISOString();
  const aligned = rows.filter(r => r.status === 'aligned').length;
  const swaggerOnly = rows.filter(r => r.status === 'swagger-only').length;
  const codeOnly = rows.filter(r => r.status === 'code-only').length;
  const drift = swaggerOnly + codeOnly;

  const rowHtml = rows
    .map(r => {
      const cls = r.status === 'aligned' ? 'ok' : 'drift';
      return `<tr class="${cls}">
  <td><code>${escapeHtml(r.method)}</code></td>
  <td><code>${escapeHtml(r.path)}</code></td>
  <td class="${r.inSwagger ? 'yes' : 'no'}">${r.inSwagger ? 'yes' : 'no'}</td>
  <td class="${r.inCode ? 'yes' : 'no'}">${r.inCode ? 'yes' : 'no'}</td>
  <td><span class="badge ${r.status}">${escapeHtml(r.status)}</span></td>
</tr>`;
    })
    .join('\n');

  const orphanHtml =
    orphans.length === 0
      ? '<p class="muted">No unmounted routers detected.</p>'
      : `<ul>${orphans
          .map(
            o =>
              `<li><code>${escapeHtml(o.method)} ${escapeHtml(o.path)}</code> — ${escapeHtml(o.note)} (<code>${escapeHtml(o.file)}</code>)</li>`
          )
          .join('')}</ul>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>API Surface Coverage — swagger.yaml vs Express routes</title>
  <style>
    :root {
      --bg: #0f1419;
      --panel: #1a2332;
      --text: #e7ecf3;
      --muted: #8b9bb4;
      --ok: #3d9a6a;
      --warn: #c9a227;
      --bad: #d64545;
      --border: #2a3548;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
      background: radial-gradient(1200px 600px at 10% -10%, #1e3a5f 0%, transparent 55%),
                  linear-gradient(160deg, #0f1419, #121a24 40%, #0d1218);
      color: var(--text);
      line-height: 1.5;
      padding: 2rem;
    }
    h1 { font-size: 1.6rem; margin: 0 0 0.35rem; }
    .sub { color: var(--muted); margin-bottom: 1.5rem; }
    .cards { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-bottom: 1.5rem; }
    .card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0.85rem 1.1rem;
      min-width: 8rem;
    }
    .card strong { display: block; font-size: 1.4rem; }
    .card span { color: var(--muted); font-size: 0.85rem; }
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
    }
    th, td { text-align: left; padding: 0.55rem 0.75rem; border-bottom: 1px solid var(--border); }
    th { background: #152033; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
    tr.drift { background: rgba(214, 69, 69, 0.08); }
    code { font-family: "IBM Plex Mono", Consolas, monospace; font-size: 0.85rem; }
    .yes { color: var(--ok); font-weight: 600; }
    .no { color: var(--bad); font-weight: 600; }
    .badge {
      display: inline-block;
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
    }
    .badge.aligned { background: rgba(61, 154, 106, 0.2); color: #7ddeb0; }
    .badge.swagger-only { background: rgba(201, 162, 39, 0.2); color: #f0d56a; }
    .badge.code-only { background: rgba(214, 69, 69, 0.2); color: #f0a0a0; }
    section { margin-top: 2rem; }
    .muted { color: var(--muted); }
    a { color: #7eb6ff; }
  </style>
</head>
<body>
  <h1>API Surface Coverage</h1>
  <p class="sub">
    Diff of <code>docs/swagger.yaml</code> paths vs Express mounts in <code>src/app.ts</code>
    and handlers in <code>src/modules/**/*.routes.ts</code>.
    Generated <time datetime="${generatedAt}">${generatedAt}</time>.
    Re-run with <code>node reports/generate-coverage.js</code>.
  </p>

  <div class="cards">
    <div class="card"><strong>${rows.length}</strong><span>total operations</span></div>
    <div class="card"><strong>${aligned}</strong><span>aligned</span></div>
    <div class="card"><strong>${drift}</strong><span>drift</span></div>
    <div class="card"><strong>${swaggerOnly}</strong><span>swagger-only</span></div>
    <div class="card"><strong>${codeOnly}</strong><span>code-only</span></div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Method</th>
        <th>Path</th>
        <th>In Swagger</th>
        <th>In Code</th>
        <th>Drift status</th>
      </tr>
    </thead>
    <tbody>
${rowHtml}
    </tbody>
  </table>

  <section>
    <h2>Unmounted routers</h2>
    <p class="muted">Route modules that define handlers but are not wired via <code>app.use</code> in <code>src/app.ts</code>.</p>
    ${orphanHtml}
  </section>

  <section>
    <h2>How to read this</h2>
    <ul>
      <li><strong>aligned</strong> — declared in Swagger and implemented on a mounted Express router.</li>
      <li><strong>swagger-only</strong> — documented in Swagger but missing from mounted code (stale docs or unmounted module).</li>
      <li><strong>code-only</strong> — live Express route with no Swagger entry (e.g. timeline historically).</li>
    </ul>
  </section>
</body>
</html>
`;
}

/**
 * @param {string} s
 * @returns {string}
 */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function main() {
  const swagger = parseSwaggerPaths();
  const code = parseCodeRoutes();
  const orphans = findUnmountedRouteFiles(code);
  const rows = diffRoutes(swagger, code);
  const html = renderHtml(rows, orphans);
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, html, 'utf8');

  const drift = rows.filter(r => r.status !== 'aligned');
  console.log(`Wrote ${path.relative(ROOT, OUT_PATH).replace(/\\/g, '/')}`);
  console.log(
    `Routes: ${rows.length} total — ${rows.length - drift.length} aligned, ${drift.length} drift`
  );
  if (drift.length) {
    console.log('Drift samples:');
    for (const r of drift.slice(0, 15)) {
      console.log(`  [${r.status}] ${r.method} ${r.path}`);
    }
    if (drift.length > 15) console.log(`  … and ${drift.length - 15} more`);
  }
}

main();
