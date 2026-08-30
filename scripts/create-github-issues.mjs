/**
 * Script to create GitHub issues from local issue-*.md files
 * that don't already exist on the remote repo.
 */
import { readdirSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const REPO = 'Navin-xmr/navin-backend';
const ISSUES_DIR = join(__dirname, '..', 'issues');

function getGitHubIssueTitles() {
  const stdout = execSync(
    `gh issue list --repo ${REPO} --state all --limit 100 --json title -q ".[].title"`,
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
  );
  return stdout.trim().split('\n').map(t => t.trim());
}

function extractTitle(content) {
  const match = content.match(/^### Issue\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

function getLocalIssues() {
  const files = readdirSync(ISSUES_DIR)
    .filter(f => {
      if (!f.startsWith('issue-') || !f.endsWith('.md')) return false;
      const num = parseInt(f.match(/\d+/)[0], 10);
      return num >= 56 && num <= 65;
    })
    .sort((a, b) => {
      const na = parseInt(a.match(/\d+/)[0], 10);
      const nb = parseInt(b.match(/\d+/)[0], 10);
      return na - nb;
    });

  return files.map(file => {
    const content = readFileSync(join(ISSUES_DIR, file), 'utf-8');
    const title = extractTitle(content);
    return { file, title, content };
  });
}

function ensureLabel(label) {
  try {
    execSync(
      `gh label create ${JSON.stringify(label)} --repo ${REPO} --description "Documentation and API quality assurance issues" --color "5319E7"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    console.log(`Created label: ${label}`);
  } catch {
    console.log(`Label "${label}" already exists or creation skipped.`);
  }
}

function main() {
  const LABEL = 'API-QA';
  ensureLabel(LABEL);

  console.log('Fetching existing GitHub issue titles...');
  const ghTitles = getGitHubIssueTitles();
  console.log(`Found ${ghTitles.length} existing GitHub issues.`);

  const locals = getLocalIssues();
  console.log(`Found ${locals.length} local issue files.`);

  const existingSet = new Set(ghTitles.map(t => t.toLowerCase().trim()));

  const toCreate = locals.filter(l => {
    if (!l.title) return false;
    const normalized = l.title.toLowerCase().trim();
    // Also check without [Category] prefix since some existing issues may have been created that way
    const withoutPrefix = normalized.replace(/^\[\w+\]\s+/, '');
    const alreadyExists = existingSet.has(normalized) || existingSet.has(withoutPrefix);
    if (alreadyExists) {
      console.log(`  SKIP (exists): ${l.title}`);
    }
    return !alreadyExists;
  });

  if (toCreate.length === 0) {
    console.log('\nAll local issues already exist on GitHub. Nothing to create.');
    return;
  }

  console.log(`\nCreating ${toCreate.length} new issue(s)...\n`);

  for (const issue of toCreate) {
    const bodyPath = join(ISSUES_DIR, issue.file);
    console.log(`Creating: ${issue.title}`);
    try {
      execSync(
        `gh issue create --repo ${REPO} --title ${JSON.stringify(issue.title)} --body-file ${JSON.stringify(bodyPath)} --label ${JSON.stringify(LABEL)}`,
        { encoding: 'utf-8', stdio: 'inherit' }
      );
    } catch (err) {
      console.error(`Failed to create issue: ${issue.title}`);
      console.error(err.message);
    }
  }
}

main();
