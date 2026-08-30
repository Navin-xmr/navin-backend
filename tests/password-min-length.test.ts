import { describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { PASSWORD_MIN_LENGTH, PASSWORD_MIN_LENGTH_MESSAGE } from '../src/shared/constants/index.js';
import { SignupBodySchema, ResetPasswordBodySchema } from '../src/modules/auth/auth.validation.js';
import {
  AcceptInvitationBodySchema,
  CreateUserBodySchema,
} from '../src/modules/users/users.validation.js';
import { buildApp } from '../src/app.js';

describe('Password minLength standardization', () => {
  const app = buildApp();
  const shortPassword = 'pass123'; // 7 chars
  const validPassword = 'pass1234'; // 8 chars

  it('exposes PASSWORD_MIN_LENGTH = 8 with a clear error message', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(PASSWORD_MIN_LENGTH_MESSAGE).toBe('Password must be at least 8 characters');
  });

  it('rejects 7-char password on signup schema', () => {
    const result = SignupBodySchema.safeParse({
      email: 'a@example.com',
      name: 'User',
      password: shortPassword,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(PASSWORD_MIN_LENGTH_MESSAGE);
    }
  });

  it('accepts 8-char password on signup schema', () => {
    const result = SignupBodySchema.safeParse({
      email: 'a@example.com',
      name: 'User',
      password: validPassword,
    });
    expect(result.success).toBe(true);
  });

  it('rejects 7-char password on reset-password schema', () => {
    const result = ResetPasswordBodySchema.safeParse({
      token: 'tok',
      newPassword: shortPassword,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(PASSWORD_MIN_LENGTH_MESSAGE);
    }
  });

  it('rejects 7-char password on invitation accept schema', () => {
    const result = AcceptInvitationBodySchema.safeParse({
      token: 'tok',
      name: 'Invited',
      password: shortPassword,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(PASSWORD_MIN_LENGTH_MESSAGE);
    }
  });

  it('accepts 8-char password on invitation accept schema', () => {
    const result = AcceptInvitationBodySchema.safeParse({
      token: 'tok',
      name: 'Invited',
      password: validPassword,
    });
    expect(result.success).toBe(true);
  });

  it('CreateUserBodySchema has no password field (invite/accept owns password)', () => {
    expect(CreateUserBodySchema.shape).not.toHaveProperty('password');
  });

  it('POST /api/auth/signup rejects 7-char password', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      email: 'short-pass-signup@example.com',
      name: 'Short',
      password: shortPassword,
    });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('8 characters');
  });

  it('POST /api/users/invitations/accept rejects 7-char password', async () => {
    const res = await request(app).post('/api/users/invitations/accept').send({
      token: 'any-token',
      name: 'Invited User',
      password: shortPassword,
    });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('8 characters');
  });
});
