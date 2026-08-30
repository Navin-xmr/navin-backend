/**
 * Smoke test: every *.routes.ts file under src/modules must be imported
 * and its exported router must be passed to app.use() inside buildApp().
 *
 * Fails if a router is exported from a module but not mounted in app.ts.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const APP_TS = path.join(ROOT, 'src', 'app.ts');
const MODULES_DIR = path.join(ROOT, 'src', 'modules');

function findRouteFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findRouteFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.routes.ts')) {
      results.push(full);
    }
  }
  return results;
}

describe('app.ts router smoke test', () => {
  const appSource = fs.readFileSync(APP_TS, 'utf8');
  const routeFiles = findRouteFiles(MODULES_DIR);

  test('at least one routes file exists', () => {
    expect(routeFiles.length).toBeGreaterThan(0);
  });

  for (const routeFile of routeFiles) {
    const relativePath = path.relative(ROOT, routeFile).replace(/\\/g, '/');

    test(`${relativePath} — router is imported and mounted in app.ts`, () => {
      const source = fs.readFileSync(routeFile, 'utf8');

      // Extract all exported Router variable names (e.g. export const fooRouter = Router())
      const exportMatches = [...source.matchAll(/export\s+const\s+(\w+Router)\b/g)];
      if (exportMatches.length === 0) {
        // No router exported — skip (template / non-router files)
        return;
      }

      for (const [, routerName] of exportMatches) {
        // Must be imported in app.ts
        expect(appSource).toMatch(
          new RegExp(`\\b${routerName}\\b`),
          `${routerName} from ${relativePath} is not imported in app.ts`
        );

        // Must be passed to app.use(...)
        expect(appSource).toMatch(
          new RegExp(`app\\.use\\([^)]*${routerName}`),
          `${routerName} from ${relativePath} is not mounted via app.use() in app.ts`
        );
      }
    });
  }
});
