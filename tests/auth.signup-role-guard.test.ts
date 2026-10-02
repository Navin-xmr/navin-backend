/**
 * Focused regression test for issue #756: the VIEWER-always signup policy.
 *
 * Security decision (#147, Option A, 2026-08-25): public signup ALWAYS assigns
 * the VIEWER role. Role is never inferred from the email domain, and no role
 * supplied in the request body can influence the assignment (the Zod schema
 * does not even accept a `role` field — see `SignupBodySchema`). Elevation is
 * exclusively invitation- and administration-only.
 *
 * This suite is deliberately separate from the legacy #147 expectation updates
 * (tests/auth.signup-default-role.test.ts) so the security contract has a
 * single, self-contained guard: ordinary domains, privileged-looking domains,
 * forged body roles, and the minted JWT's `role` claim are all covered.
 *
 * @see issue-#756
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Application } from 'express';
import { seedAuthShipmentSuite, cleanupAuthShipmentSuite } from './helpers/authShipmentSuite.js';

const JWT_SECRET = process.env.JWT_SECRET ?? 'test-jwt-secret-key-at-least-32-chars-long!';

/** Cases a naive domain-based implementation would wrongly elevate. */
const PRIVILEGED_LOOKING_DOMAINS = [
  'navin.io',
  'navin-admin.com',
  'admin.navin.io',
] as const;

/** Roles an attacker might forge into the signup body or expect from a domain. */
const ELEVATED_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'] as const;

/**
 * Distinct signup emails used by this suite. POST /api/auth/signup sits behind
 * `strictLimiter` (10 req/min/IP, src/app.ts:67) — the total here must stay
 * within that budget when the suite runs in isolation.
 */
const SIGNUP_EMAILS = {
  ordinary: 'standard@plain-domain.test',
  domainProbes: ['elevate-me@navin.io', 'elevate-me@navin-admin.com', 'elevate-me@admin.navin.io'],
  forged: ['forged-super_admin@plain-domain.test', 'forged-admin@plain-domain.test', 'forged-manager@plain-domain.test'],
  tokenClaim: 'token-claim@navin.io',
  persisted: 'persist@navin.io',
} as const;

describe('Issue #756 - Signup ignores requested and email-derived roles (VIEWER-always)', () => {
  let app: Application;
  let testOrgId: string;

  beforeAll(async () => {
    ({ app, testOrgId } = await seedAuthShipmentSuite());
  }, 120_000);

  afterAll(cleanupAuthShipmentSuite);

  describe('ordinary domains', () => {
    it('assigns VIEWER to a standard public-domain signup', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({
          email: SIGNUP_EMAILS.ordinary,
          name: 'Policy Probe Ordinary',
          password: 'password123',
          organizationId: testOrgId,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.role).toBe('VIEWER');
    });
  });

  describe('privileged-looking domains', () => {
    it.each(PRIVILEGED_LOOKING_DOMAINS)('assigns VIEWER to a signup from the privileged-looking domain %s', async domain => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({
          email: SIGNUP_EMAILS.domainProbes[PRIVILEGED_LOOKING_DOMAINS.indexOf(domain)],
          name: `Domain Probe ${domain}`,
          password: 'password123',
          organizationId: testOrgId,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.user.role).toBe('VIEWER');
    });
  });

  describe('forged role in the request body', () => {
    it.each(ELEVATED_ROLES)('ignores a forged role: %s in the signup body still yields VIEWER', async forgedRole => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({
          email: SIGNUP_EMAILS.forged[ELEVATED_ROLES.indexOf(forgedRole)],
          name: `Forged ${forgedRole}`,
          password: 'password123',
          organizationId: testOrgId,
          role: forgedRole,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.user.role).toBe('VIEWER');
    });
  });

  describe('token contract', () => {
    it('mints a JWT whose role claim is VIEWER, never an elevated role', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({
          email: SIGNUP_EMAILS.tokenClaim,
          name: 'Token Claim Probe',
          password: 'password123',
          organizationId: testOrgId,
        });

      expect(res.status).toBe(201);
      const decoded = jwt.decode(res.body.data.token, { json: true });
      expect(decoded).not.toBeNull();
      expect(decoded?.role).toBe('VIEWER');
      expect(ELEVATED_ROLES).not.toContain(decoded?.role);
    });
  });

  describe('role storage', () => {
    it('never persists an elevated role for any signup variant', async () => {
      // A forged-role signup plus a login read-back proves the VIEWER role was
      // persisted — not merely echoed in the signup response.
      const forged = await request(app)
        .post('/api/auth/signup')
        .send({
          email: SIGNUP_EMAILS.persisted,
          name: 'Persisted Role Probe',
          password: 'password123',
          organizationId: testOrgId,
          role: 'MANAGER',
        });

      expect(forged.status).toBe(201);
      expect(forged.body.data.user.role).toBe('VIEWER');

      // Login exercises the persisted role straight from the database.
      const login = await request(app).post('/api/auth/login').send({
        email: SIGNUP_EMAILS.persisted,
        password: 'password123',
      });

      expect(login.status).toBe(200);
      expect(login.body.data.user.role).toBe('VIEWER');
    });

    it('rejects duplicate signups with EMAIL_TAKEN rather than re-evaluating roles', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({
          email: SIGNUP_EMAILS.persisted,
          name: 'Duplicate Signup',
          password: 'password123',
          organizationId: testOrgId,
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('EMAIL_TAKEN');
    });
  });
});
