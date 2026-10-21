#!/usr/bin/env node

/**
 * Regenerate reports/issues-data.json from current GitHub wave-id issues.
 *
 * The core wave program is exactly 100 issues across phases P1–P6.
 * Phase 7 (and later) batches are included so the dashboard reflects
 * current GitHub state.
 *
 * Usage (from repo root):
 *   node reports/generate-issues-data.js
 *
 * Requires `gh` authenticated against Navin-xmr/navin-backend.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.join(__dirname, 'issues-data.json');
const REPO = 'Navin-xmr/navin-backend';

const DOMAIN_MAP = {
  'API-QA': 'API-QA',
  'API Coverage': 'API-QA',
  Auth: 'Auth',
  Users: 'Users',
  Shipments: 'Shipments',
  Payments: 'Payments',
  Telemetry: 'Telemetry',
  WebSockets: 'WebSockets',
  'Public Tracking': 'Shipments',
  Tooling: 'API-QA',
  DX: 'API-QA',
  Docs: 'API-QA',
  Security: 'Auth',
  Infra: 'API-QA',
  Infrastructure: 'API-QA',
  Docker: 'API-QA',
  QA: 'API-QA',
  Chore: 'API-QA',
  Testing: 'API-QA',
  Chain: 'Shipments',
  Ledger: 'Shipments',
  Notifications: 'Users',
  Organizations: 'Users',
  Analytics: 'Telemetry',
  Anomaly: 'Telemetry',
  Workers: 'WebSockets',
  Realtime: 'WebSockets',
};

const WAVE_RE = /wave-id:\s*(P(\d+)-\d+)/i;
const TIER_RE = /\*\*Tier:\*\*\s*(?:🟢|🟡|🔴)?\s*(Easy|Medium|Hard)/;
const DOMAIN_RE = /## Domain:\s*(.+)/;

function ghSearch(page) {
  const q = encodeURIComponent(`repo:${REPO} "wave-id" in:body`);
  const raw = execFileSync(
    'gh',
    ['api', `search/issues?q=${q}&per_page=100&page=${page}`],
    { encoding: 'utf8' }
  );
  return JSON.parse(raw);
}

function fetchAllWaveIssues() {
  const items = [];
  let page = 1;
  let total = Infinity;
  while (items.length < total) {
    const data = ghSearch(page);
    total = data.total_count ?? 0;
    const batch = data.items ?? [];
    items.push(...batch);
    if (batch.length === 0) break;
    page += 1;
    if (page > 10) break;
  }
  return items;
}

function mapDomain(raw) {
  const primary = raw.split('/')[0].trim();
  if (DOMAIN_MAP[primary]) return DOMAIN_MAP[primary];
  if (DOMAIN_MAP[raw]) return DOMAIN_MAP[raw];
  if (Object.values(DOMAIN_MAP).includes(primary)) return primary;
  return 'API-QA';
}

function normalizeIssue(it) {
  const body = it.body || '';
  const m = WAVE_RE.exec(body);
  if (!m) return null;
  const phaseNum = Number(m[2]);
  if (phaseNum > 7) return null;

  const labels = (it.labels || []).map(l => l.name);
  let tier = 'Medium';
  const tm = TIER_RE.exec(body);
  if (tm) {
    tier = tm[1];
  } else {
    for (const lab of labels) {
      if (lab.includes('Easy')) tier = 'Easy';
      else if (lab.includes('Hard')) tier = 'Hard';
      else if (lab.includes('Medium')) tier = 'Medium';
    }
  }

  const dm = DOMAIN_RE.exec(body);
  const titleM = /^\[([^\]]+)\]/.exec(it.title || '');
  const rawDomain = (dm ? dm[1].trim() : titleM ? titleM[1] : 'Other');

  return {
    number: it.number,
    title: it.title,
    tier,
    domain: mapDomain(rawDomain),
    status: it.state === 'closed' ? 'closed' : 'open',
    wave_id: m[1],
    phase: `P${phaseNum}`,
  };
}

function buildPayload(issues) {
  issues.sort((a, b) => b.number - a.number);
  const nums = issues.map(i => i.number).sort((a, b) => a - b);
  const byTier = { Easy: 0, Medium: 0, Hard: 0 };
  const byDomain = {};
  let open = 0;
  let closed = 0;
  for (const i of issues) {
    byTier[i.tier] = (byTier[i.tier] || 0) + 1;
    byDomain[i.domain] = (byDomain[i.domain] || 0) + 1;
    if (i.status === 'open') open += 1;
    else closed += 1;
  }

  const hard = [...issues]
    .filter(i => i.tier === 'Hard')
    .sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || b.number - a.number)
    .slice(0, 10)
    .map(i => ({ number: i.number, title: i.title, domain: i.domain }));

  return {
    generated: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    issueRange: `${nums[0]}-${nums[nums.length - 1]}`,
    totalIssues: issues.length,
    waveProgram: {
      corePhases: 'P1-P6',
      coreIssueCount: issues.filter(i => Number(i.phase.slice(1)) <= 6).length,
      phase7Batch: issues.filter(i => i.phase === 'P7').length,
    },
    summary: {
      open,
      closed,
      byTier,
      byDomain: Object.fromEntries(Object.entries(byDomain).sort(([a], [b]) => a.localeCompare(b))),
    },
    hardIssues: hard,
    issues: issues.map(({ number, title, tier, domain, status }) => ({
      number,
      title,
      tier,
      domain,
      status,
    })),
  };
}

const raw = fetchAllWaveIssues();
const issues = raw.map(normalizeIssue).filter(Boolean);
const payload = buildPayload(issues);
fs.writeFileSync(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`);
console.log(
  `Wrote ${OUT_FILE}: ${payload.totalIssues} issues (${payload.issueRange}); ` +
    `core P1–P6=${payload.waveProgram.coreIssueCount}, P7=${payload.waveProgram.phase7Batch}`
);
