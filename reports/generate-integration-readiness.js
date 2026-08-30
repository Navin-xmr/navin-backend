#!/usr/bin/env node
/**
 * Integration readiness report generator.
 *
 * Reads reports/integration-readiness-data.json and writes
 * reports/API_INTEGRATION_READINESS.html with a color-coded status table.
 *
 * Usage: node reports/generate-integration-readiness.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_PATH = path.join(ROOT, 'reports', 'integration-readiness-data.json');
const OUT_PATH = path.join(ROOT, 'reports', 'API_INTEGRATION_READINESS.html');

const GITHUB_REPO = 'mathstickz/navin-backend';

function githubIssueUrl(number) {
  return `https://github.com/${GITHUB_REPO}/issues/${number}`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"');
}

function statusBadge(status) {
  const map = {
    MET: { label: 'MET', class: 'met', icon: '🟢' },
    PARTIAL: { label: 'PARTIAL', class: 'partial', icon: '🟡' },
    NOT_MET: { label: 'NOT MET', class: 'not-met', icon: '🔴' },
  };
  const b = map[status] || map.NOT_MET;
  return `<span class="badge ${b.class}">${b.icon} ${escapeHtml(b.label)}</span>`;
}

function renderIssues(issues) {
  if (!issues || issues.length === 0) return '<span class="muted">—</span>';
  return issues
    .map(
      (n) =>
        `<a class="issue-link" href="${escapeHtml(githubIssueUrl(n))}" target="_blank" rel="noopener">#${n}</a>`
    )
    .join(' ');
}

function renderHtml(data) {
  const generatedAt = new Date().toISOString();
  const { sections, summary } = data;

  const met = sections.filter((s) => s.status === 'MET').length;
  const partial = sections.filter((s) => s.status === 'PARTIAL').length;
  const notMet = sections.filter((s) => s.status === 'NOT_MET').length;
  const endpointCoverage =
    summary.totalEndpoints > 0 ? Math.round((summary.implementedEndpoints / summary.totalEndpoints) * 100) : 0;

  const rows = sections
    .map(
      (s) => {
        const coveragePct =
          s.endpointCount > 0 ? Math.round((s.implementedEndpoints / s.endpointCount) * 100) : (s.status === 'MET' ? 100 : s.status === 'PARTIAL' ? 50 : 0);
        return `<tr>
          <td>${escapeHtml(s.name)}</td>
          <td>${statusBadge(s.status)}</td>
          <td>${s.implementedEndpoints} / ${s.endpointCount}</td>
          <td>${coveragePct}%</td>
          <td>${renderIssues(s.issues)}</td>
          <td>${escapeHtml(s.notes)}</td>
        </tr>`;
      }
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Navin Backend — API Integration Readiness</title>
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
      --accent: #7eb6ff;
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
    h1 { font-size: 1.8rem; margin: 0 0 0.5rem; }
    .sub { color: var(--muted); margin-bottom: 2rem; }
    .meta { color: var(--muted); font-size: 0.9rem; margin-bottom: 1.5rem; }
    .meta strong { color: var(--text); }

    .summary {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 2rem;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 1rem;
    }
    .summary-item {
      background: #0f1419;
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 1rem;
      text-align: center;
    }
    .summary-item .label { font-size: 0.8rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
    .summary-item .value { font-size: 1.6rem; font-weight: 700; margin-top: 0.3rem; }
    .summary-item.met .value { color: var(--ok); }
    .summary-item.partial .value { color: var(--warn); }
    .summary-item.not-met .value { color: var(--bad); }
    .summary-item.coverage .value { color: var(--accent); }

    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
    }
    th, td { text-align: left; padding: 0.65rem 0.75rem; border-bottom: 1px solid var(--border); vertical-align: top; }
    th { background: #152033; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: rgba(125,182,255,0.04); }

    .badge {
      display: inline-block;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      font-size: 0.8rem;
      font-weight: 600;
      white-space: nowrap;
    }
    .badge.met { background: rgba(61,154,106,0.2); color: #7ddeb0; }
    .badge.partial { background: rgba(201,162,39,0.2); color: #f0d56a; }
    .badge.not-met { background: rgba(214,69,69,0.2); color: #f0a0a0; }

    .issue-link {
      display: inline-block;
      margin-right: 0.4rem;
      color: var(--accent);
      text-decoration: none;
      font-size: 0.9rem;
    }
    .issue-link:hover { text-decoration: underline; }
    .muted { color: var(--muted); }

    .footer { color: var(--muted); font-size: 0.85rem; text-align: center; margin-top: 1.5rem; }
  </style>
</head>
<body>
  <h1>Navin Backend — API Integration Readiness</h1>
  <p class="sub">Section-level status derived from <code>backend-integration-requirements.md</code> vs current Express implementation.</p>
  <p class="meta">
    <strong>Generated:</strong> <time datetime="${generatedAt}">${generatedAt}</time> &nbsp;|&nbsp;
    <strong>Source:</strong> <code>reports/integration-readiness-data.json</code> &nbsp;|&nbsp;
    <strong>Regenerate:</strong> <code>node reports/generate-integration-readiness.js</code>
  </p>

  <div class="summary">
    <div class="summary-item">
      <div class="label">Sections</div>
      <div class="value">${summary.totalSections}</div>
    </div>
    <div class="summary-item met">
      <div class="label">Met</div>
      <div class="value">${met}</div>
    </div>
    <div class="summary-item partial">
      <div class="label">Partial</div>
      <div class="value">${partial}</div>
    </div>
    <div class="summary-item not-met">
      <div class="label">Not Met</div>
      <div class="value">${notMet}</div>
    </div>
    <div class="summary-item coverage">
      <div class="label">Endpoint Coverage</div>
      <div class="value">${endpointCoverage}%</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Section</th>
        <th>Status</th>
        <th>Endpoints</th>
        <th>Coverage</th>
        <th>Issues</th>
        <th>Notes</th>
      </tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>

  <div class="footer">
    Generated: ${generatedAt} &nbsp;|&nbsp; Refresh by re-running <code>node reports/generate-integration-readiness.js</code>
  </div>
</body>
</html>
`;
}

function main() {
  if (!fs.existsSync(DATA_PATH)) {
    console.error(`Missing data file: ${DATA_PATH}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(DATA_PATH, 'utf8');
  const data = JSON.parse(raw);

  const html = renderHtml(data);
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, html, 'utf8');

  console.log(`Wrote ${path.relative(ROOT, OUT_PATH).replace(/\\/g, '/')}`);
  console.log(`Sections: ${data.sections.length} | Met: ${data.summary.met} | Partial: ${data.summary.partial} | Not Met: ${data.summary.notMet}`);
}

main();