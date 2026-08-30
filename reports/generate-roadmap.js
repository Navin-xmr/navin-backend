#!/usr/bin/env node

/**
 * Generate roadmap dashboard HTML from issue data
 * 
 * This script generates a visual roadmap dashboard that tracks the 60-issue wave progress.
 * It reads from issues-data.json and creates an HTML dashboard with:
 * - Tier distribution (Easy/Medium/Hard) - donut chart
 * - Domain breakdown - stacked bar chart
 * - Open vs Closed status - progress bar
 * - Hard issues hot-list
 * - Completion statistics
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPORTS_DIR = __dirname;
const DATA_FILE = path.join(REPORTS_DIR, 'issues-data.json');
const OUTPUT_FILE = path.join(REPORTS_DIR, 'ROADMAP_DASHBOARD.html');

// Color scheme
const COLORS = {
  easy: '#10b981',      // green
  medium: '#f59e0b',    // amber
  hard: '#ef4444',      // red
  open: '#3b82f6',      // blue
  closed: '#6b7280',    // gray
  domain: {
    'API-QA': '#8b5cf6',
    'Auth': '#ec4899',
    'Users': '#06b6d4',
    'Shipments': '#f97316',
    'Payments': '#14b8a6',
    'Telemetry': '#eab308',
    'WebSockets': '#6366f1'
  }
};

/**
 * Generate SVG donut chart for tier distribution
 */
function generateTierChart(data) {
  const { Easy, Medium, Hard } = data.summary.byTier;
  const total = Easy + Medium + Hard;
  
  const easyPercent = (Easy / total) * 100;
  const mediumPercent = (Medium / total) * 100;
  const hardPercent = (Hard / total) * 100;

  // Convert percentages to angles for SVG arc
  const easyAngle = (easyPercent / 100) * 360;
  const mediumAngle = (mediumPercent / 100) * 360;
  const hardAngle = (hardPercent / 100) * 360;

  const radius = 45;
  const cx = 60, cy = 60;

  // Helper to calculate SVG arc path
  function polarToCartesian(centerX, centerY, radius, angleInDegrees) {
    const angleInRadians = (angleInDegrees - 90) * Math.PI / 180.0;
    return {
      x: centerX + (radius * Math.cos(angleInRadians)),
      y: centerY + (radius * Math.sin(angleInRadians))
    };
  }

  function describeArc(x, y, radius, startAngle, endAngle) {
    const start = polarToCartesian(x, y, radius, endAngle);
    const end = polarToCartesian(x, y, radius, startAngle);
    const largeArc = endAngle - startAngle <= 180 ? "0" : "1";
    return [
      "M", x, y,
      "L", start.x, start.y,
      "A", radius, radius, 0, largeArc, 0, end.x, end.y,
      "Z"
    ].join(" ");
  }

  let currentAngle = 0;

  // SVG paths for each tier
  const easyPath = describeArc(cx, cy, radius, currentAngle, currentAngle + easyAngle);
  currentAngle += easyAngle;
  const mediumPath = describeArc(cx, cy, radius, currentAngle, currentAngle + mediumAngle);
  currentAngle += mediumAngle;
  const hardPath = describeArc(cx, cy, radius, currentAngle, currentAngle + hardAngle);

  return `
    <svg viewBox="0 0 200 140" class="donut-chart">
      <path d="${easyPath}" fill="${COLORS.easy}" class="donut-segment"/>
      <path d="${mediumPath}" fill="${COLORS.medium}" class="donut-segment"/>
      <path d="${hardPath}" fill="${COLORS.hard}" class="donut-segment"/>
      <circle cx="${cx}" cy="${cy}" r="28" fill="white"/>
      <text x="${cx}" y="62" text-anchor="middle" font-size="16" font-weight="bold" fill="#1f2937">${total}</text>
      <text x="${cx}" y="78" text-anchor="middle" font-size="11" fill="#6b7280">issues</text>
    </svg>
  `;
}

/**
 * Generate SVG stacked bar chart for domain distribution
 */
function generateDomainChart(data) {
  const domains = data.summary.byDomain;
  const domainNames = Object.keys(domains).sort();
  const maxCount = Math.max(...Object.values(domains));
  const barHeight = 20;
  const barSpacing = 28;

  let bars = '';
  domainNames.forEach((domain, index) => {
    const count = domains[domain];
    const percentage = (count / maxCount) * 100;
    const width = (percentage / 100) * 350;
    const y = index * barSpacing;

    bars += `
      <g>
        <rect x="50" y="${y}" width="${width}" height="${barHeight}" fill="${COLORS.domain[domain] || '#94a3b8'}" rx="2"/>
        <text x="8" y="${y + 14}" font-size="12" font-weight="500" fill="#374151">${domain}</text>
        <text x="${50 + width + 5}" y="${y + 14}" font-size="12" font-weight="bold" fill="#1f2937">${count}</text>
      </g>
    `;
  });

  return `
    <svg viewBox="0 0 420 ${domainNames.length * barSpacing + 10}" class="domain-chart">
      ${bars}
    </svg>
  `;
}

/**
 * Generate progress bar for open vs closed
 */
function generateProgressBar(data) {
  const { open, closed } = data.summary;
  const total = open + closed;
  const closedPercent = (closed / total) * 100;
  const openPercent = (open / total) * 100;

  return `
    <div class="progress-container">
      <div class="progress-bar">
        <div class="progress-segment closed" style="width: ${closedPercent}%" title="Closed: ${closed}"></div>
        <div class="progress-segment open" style="width: ${openPercent}%" title="Open: ${open}"></div>
      </div>
      <div class="progress-stats">
        <div class="stat">
          <span class="stat-label">Closed</span>
          <span class="stat-value closed-text">${closed}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Open</span>
          <span class="stat-value open-text">${open}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Completion</span>
          <span class="stat-value">${closedPercent.toFixed(1)}%</span>
        </div>
      </div>
    </div>
  `;
}

/**
 * Generate hard issues hot-list
 */
function generateHardIssuesList(data) {
  const issues = data.hardIssues.slice(0, 10);
  
  return `
    <ul class="hard-issues-list">
      ${issues.map(issue => `
        <li class="hard-issue-item">
          <span class="issue-number">#${issue.number}</span>
          <span class="issue-title">${issue.title}</span>
          <span class="issue-domain">${issue.domain}</span>
        </li>
      `).join('')}
    </ul>
  `;
}

/**
 * Generate the complete HTML dashboard
 */
function generateDashboardHTML(data) {
  const generatedDate = new Date(data.generated).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Navin Backend - 60-Issue Wave Roadmap</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 40px 20px;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
    }

    .header {
      text-align: center;
      color: white;
      margin-bottom: 40px;
    }

    .header h1 {
      font-size: 2.5em;
      font-weight: 700;
      margin-bottom: 8px;
    }

    .header p {
      font-size: 1.1em;
      opacity: 0.9;
    }

    .meta {
      font-size: 0.9em;
      opacity: 0.8;
      margin-top: 8px;
    }

    .dashboard {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 30px;
      margin-bottom: 30px;
    }

    .card {
      background: white;
      border-radius: 12px;
      padding: 30px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
      transition: transform 0.2s, box-shadow 0.2s;
    }

    .card:hover {
      transform: translateY(-2px);
      box-shadow: 0 25px 30px -5px rgba(0, 0, 0, 0.15);
    }

    .card-title {
      font-size: 1.3em;
      font-weight: 600;
      color: #1f2937;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .card-icon {
      font-size: 1.2em;
    }

    .donut-chart {
      max-width: 100%;
      height: auto;
    }

    .donut-segment {
      opacity: 0.9;
      transition: opacity 0.2s;
    }

    .donut-segment:hover {
      opacity: 1;
    }

    .domain-chart {
      max-width: 100%;
      height: auto;
    }

    .legend {
      display: flex;
      gap: 20px;
      margin-top: 20px;
      flex-wrap: wrap;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.9em;
    }

    .legend-color {
      width: 16px;
      height: 16px;
      border-radius: 3px;
    }

    .progress-container {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .progress-bar {
      display: flex;
      height: 40px;
      border-radius: 8px;
      overflow: hidden;
      background: #f3f4f6;
      box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.05);
    }

    .progress-segment {
      transition: all 0.3s ease;
    }

    .progress-segment.closed {
      background: ${COLORS.closed};
    }

    .progress-segment.open {
      background: ${COLORS.open};
    }

    .progress-stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 15px;
    }

    .stat {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 15px;
      background: #f9fafb;
      border-radius: 8px;
      border: 1px solid #e5e7eb;
    }

    .stat-label {
      font-size: 0.85em;
      color: #6b7280;
      font-weight: 500;
      margin-bottom: 5px;
    }

    .stat-value {
      font-size: 1.5em;
      font-weight: 700;
      color: #1f2937;
    }

    .stat-value.open-text {
      color: ${COLORS.open};
    }

    .stat-value.closed-text {
      color: ${COLORS.closed};
    }

    .hard-issues-list {
      list-style: none;
    }

    .hard-issue-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px;
      margin-bottom: 8px;
      background: #fef2f2;
      border-left: 3px solid ${COLORS.hard};
      border-radius: 4px;
      font-size: 0.95em;
      transition: background 0.2s;
    }

    .hard-issue-item:hover {
      background: #fee2e2;
    }

    .issue-number {
      font-weight: 700;
      color: ${COLORS.hard};
      min-width: 50px;
    }

    .issue-title {
      flex: 1;
      color: #1f2937;
    }

    .issue-domain {
      background: #fecaca;
      color: #991b1b;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.85em;
      font-weight: 600;
      white-space: nowrap;
    }

    .full-width {
      grid-column: 1 / -1;
    }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 15px;
      margin-bottom: 30px;
    }

    .summary-item {
      background: white;
      padding: 20px;
      border-radius: 12px;
      text-align: center;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
    }

    .summary-item h3 {
      font-size: 0.9em;
      color: #6b7280;
      font-weight: 500;
      margin-bottom: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .summary-item .number {
      font-size: 2.5em;
      font-weight: 700;
      color: #1f2937;
    }

    .summary-item.easy .number { color: ${COLORS.easy}; }
    .summary-item.medium .number { color: ${COLORS.medium}; }
    .summary-item.hard .number { color: ${COLORS.hard}; }

    @media (max-width: 768px) {
      .dashboard {
        grid-template-columns: 1fr;
      }

      .summary-grid {
        grid-template-columns: repeat(2, 1fr);
      }

      .header h1 {
        font-size: 1.8em;
      }

      .progress-stats {
        grid-template-columns: 1fr;
      }
    }

    .footer {
      text-align: center;
      color: white;
      margin-top: 40px;
      font-size: 0.9em;
      opacity: 0.8;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🚀 60-Issue Wave Roadmap</h1>
      <p>Navin Backend Development Progress</p>
      <div class="meta">
        <strong>Generated:</strong> ${generatedDate}<br>
        <strong>Coverage:</strong> Issues #${data.issueRange}
      </div>
    </div>

    <div class="summary-grid">
      <div class="summary-item easy">
        <h3>Easy</h3>
        <div class="number">${data.summary.byTier.Easy}</div>
      </div>
      <div class="summary-item medium">
        <h3>Medium</h3>
        <div class="number">${data.summary.byTier.Medium}</div>
      </div>
      <div class="summary-item hard">
        <h3>Hard</h3>
        <div class="number">${data.summary.byTier.Hard}</div>
      </div>
      <div class="summary-item">
        <h3>Total</h3>
        <div class="number" style="color: #667eea;">${data.totalIssues}</div>
      </div>
    </div>

    <div class="dashboard">
      <div class="card">
        <div class="card-title">
          <span class="card-icon">📊</span>
          Tier Distribution
        </div>
        ${generateTierChart(data)}
        <div class="legend">
          <div class="legend-item">
            <div class="legend-color" style="background: ${COLORS.easy};"></div>
            <span>Easy</span>
          </div>
          <div class="legend-item">
            <div class="legend-color" style="background: ${COLORS.medium};"></div>
            <span>Medium</span>
          </div>
          <div class="legend-item">
            <div class="legend-color" style="background: ${COLORS.hard};"></div>
            <span>Hard</span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">
          <span class="card-icon">📈</span>
          Completion Status
        </div>
        ${generateProgressBar(data)}
      </div>

      <div class="card full-width">
        <div class="card-title">
          <span class="card-icon">🏢</span>
          Domain Breakdown
        </div>
        ${generateDomainChart(data)}
      </div>

      <div class="card full-width">
        <div class="card-title">
          <span class="card-icon">🔴</span>
          Hard Issues Hot-List
        </div>
        ${generateHardIssuesList(data)}
      </div>
    </div>

    <div class="footer">
      <p>Last updated: ${new Date().toLocaleString()}</p>
      <p>Dashboard data refreshed automatically — see reports/generate-roadmap.js for details</p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Main execution
 */
function main() {
  try {
    // Read data file
    if (!fs.existsSync(DATA_FILE)) {
      console.error(`❌ Data file not found: ${DATA_FILE}`);
      console.error('Run: node reports/generate-roadmap.js to create it');
      process.exit(1);
    }

    const rawData = fs.readFileSync(DATA_FILE, 'utf-8');
    const data = JSON.parse(rawData);

    // Validate data structure
    if (!data.summary || !data.summary.byTier || !data.summary.byDomain) {
      console.error('❌ Invalid data structure in issues-data.json');
      process.exit(1);
    }

    // Generate HTML
    const html = generateDashboardHTML(data);

    // Write HTML file
    fs.writeFileSync(OUTPUT_FILE, html, 'utf-8');

    console.log(`✅ Dashboard generated successfully!`);
    console.log(`📄 Output: ${OUTPUT_FILE}`);
    console.log(`🌐 Open in browser to view`);
    console.log(`\n📊 Summary:`);
    console.log(`   Total Issues: ${data.totalIssues}`);
    console.log(`   Easy: ${data.summary.byTier.Easy}, Medium: ${data.summary.byTier.Medium}, Hard: ${data.summary.byTier.Hard}`);
    console.log(`   Open: ${data.summary.open}, Closed: ${data.summary.closed}`);
    console.log(`   Completion: ${((data.summary.closed / data.totalIssues) * 100).toFixed(1)}%`);

  } catch (error) {
    console.error('❌ Error generating dashboard:', error.message);
    process.exit(1);
  }
}

main();
