import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UserRole } from '../src/shared/constants/roles.js';

process.env.MONGO_URI ??= 'mongodb://localhost:27017/navin-test';
process.env.JWT_SECRET ??= 'test-secret-minimum-32-chars-for-validation';

const { routeRoles: shipmentRoles } = await import('../src/modules/shipments/shipments.routes.js');
const { routeRoles: userRoles } = await import('../src/modules/users/users.routes.js');
const { routeRoles: analyticsRoles } = await import('../src/modules/analytics/analytics.routes.js');
const { routeRoles: anomalyRoles } = await import('../src/modules/anomaly/anomaly.routes.js');

describe('docs/auth-model.md synchronization with live RBAC, 2FA, and sessions', () => {
  const docPath = resolve(process.cwd(), 'docs/auth-model.md');
  const content = readFileSync(docPath, 'utf8');

  it('documents every UserRole enum value including DRIVER', () => {
    for (const role of Object.values(UserRole)) {
      expect(content).toContain(`\`${role}\``);
    }
    expect(content).not.toContain('backend has no `DRIVER`');
    expect(content).not.toContain('| Role `Driver` | *(none)* |');
  });

  it('includes DRIVER column and accurate VIEWER audit-logs/activity permissions in the matrix', () => {
    expect(content).toContain(
      '| Capability / area | SUPER_ADMIN | ADMIN | MANAGER | DRIVER | VIEWER | CUSTOMER |'
    );
    expect(content).toMatch(
      /\|\s*Audit logs \/ Activity — `GET \/api\/activity`\s*\|\s*Y\s*\|\s*Y\s*\|\s*Y\s*\|\s*—\s*\|\s*Y\s*\|\s*—\s*\|/
    );

    const auditRoutes = readFileSync(
      resolve(process.cwd(), 'src/modules/audit-logs/auditLogs.routes.ts'),
      'utf8'
    );
    expect(auditRoutes).toContain('UserRole.VIEWER');
  });

  it('cross-checks routeRoles exports against the documented permission matrix', () => {
    expect(shipmentRoles['GET /api/shipments']).toEqual([
      UserRole.ADMIN,
      UserRole.MANAGER,
      UserRole.VIEWER,
    ]);
    expect(shipmentRoles['GET /api/shipments/:id']).toEqual([
      UserRole.SUPER_ADMIN,
      UserRole.ADMIN,
      UserRole.MANAGER,
      UserRole.VIEWER,
    ]);
    expect(userRoles['POST /api/users']).toEqual([UserRole.ADMIN, UserRole.SUPER_ADMIN]);
    expect(userRoles['DELETE /api/users/:id']).toEqual([UserRole.ADMIN, UserRole.SUPER_ADMIN]);
    expect(analyticsRoles['GET /api/analytics/performance']).toEqual([
      UserRole.ADMIN,
      UserRole.MANAGER,
    ]);
    expect(anomalyRoles['GET /api/anomalies']).toEqual([UserRole.ADMIN, UserRole.MANAGER]);

    expect(content).toMatch(
      /\|\s*Shipments — list \/ timeline\s*\|\s*—†\s*\|\s*Y\s*\|\s*Y\s*\|\s*—\s*\|\s*Y\s*\|\s*—\s*\|/
    );
    expect(content).toMatch(
      /\|\s*Shipments — get by id\s*\|\s*Y\s*\|\s*Y\s*\|\s*Y\s*\|\s*—\s*\|\s*Y\s*\|\s*—\s*\|/
    );
  });

  it('documents TOTP 2FA endpoints and Session Management endpoints', () => {
    expect(content).toContain('## TOTP Two-Factor Authentication (`/api/auth/2fa/*`)');
    expect(content).toContain('`POST /api/auth/2fa/setup`');
    expect(content).toContain('`POST /api/auth/2fa/verify`');
    expect(content).toContain('`DELETE /api/auth/2fa`');
    expect(content).toContain('`POST /api/auth/2fa/backup-codes/regenerate`');

    expect(content).toContain('## Session Management & Refresh Lifecycle');
    expect(content).toContain('`GET /api/auth/sessions`');
    expect(content).toContain('`DELETE /api/auth/sessions/:jti`');
    expect(content).toContain('`POST /api/auth/refresh`');
  });
});
