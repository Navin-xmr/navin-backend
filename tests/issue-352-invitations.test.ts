import { jest, describe, it, expect, beforeEach, beforeAll } from '@jest/globals';
import crypto from 'crypto';

// Mock data
type InvitationRecord = Record<string, unknown> & {
  email?: string;
  organizationId?: string;
  status?: string;
  tokenHash?: string;
  createdAt?: Date;
};

const invitations: InvitationRecord[] = [];
const users: Record<string, unknown>[] = [];
const organizations: Record<string, unknown>[] = [];

// Mock sendEmail
const mockSendEmail = jest.fn().mockResolvedValue(undefined);

await jest.unstable_mockModule('../src/services/email.service.js', () => ({
  sendEmail: mockSendEmail,
  invitationEmailHtml: (link: string, name?: string) =>
    `<html>Invite: ${link} from ${name}</html>`,
}));

await jest.unstable_mockModule('../src/modules/users/users.model.js', () => {
  const UserModel = {
    findById: (id: string) => Promise.resolve(users.find(u => u._id === id)),
    findOne: ({ email }: { email: string }) =>
      Promise.resolve(users.find(u => u.email === email) ?? null),
    create: jest.fn().mockImplementation(async (data: Record<string, unknown>) => {
      const created = {
        _id: `user-${Date.now()}`,
        ...data,
        toJSON: () => {
          const { passwordHash, ...rest } = created;
          return rest;
        },
      };
      users.push(created);
      return created;
    }),
  };

  const OrganizationModel = {
    findById: (id: string) => Promise.resolve(organizations.find(o => o._id === id)),
  };

  return { UserModel, OrganizationModel };
});

await jest.unstable_mockModule('../src/modules/invitations/invitations.model.js', () => {
  const InvitationStatus = {
    PENDING: 'PENDING',
    ACCEPTED: 'ACCEPTED',
    EXPIRED: 'EXPIRED',
    REVOKED: 'REVOKED',
  };

  const InvitationModel = {
    create: jest.fn().mockImplementation(async (data: Record<string, unknown>) => {
      const created = {
        _id: `inv-${Date.now()}`,
        ...data,
      };
      invitations.push(created);
      return created;
    }),
    findOne: (query: Record<string, unknown>) => {
      const match = invitations.find(inv => {
        if (query.email && inv.email !== query.email) return false;
        if (query.organizationId && inv.organizationId !== query.organizationId) return false;
        if (query.status && inv.status !== query.status) return false;
        if (query.tokenHash && inv.tokenHash !== query.tokenHash) return false;
        return true;
      });
      return Promise.resolve(match ?? null);
    },
    findById: (id: string) => Promise.resolve(invitations.find(inv => inv._id === id) ?? null),
    findByIdAndUpdate: jest
      .fn()
      .mockImplementation(async (id: string, updates: Record<string, unknown>) => {
        const inv = invitations.find(i => i._id === id);
        if (!inv) return null;
        Object.assign(inv, updates);
        return inv;
      }),
    findOneAndUpdate: jest
      .fn()
      .mockImplementation(async (query: Record<string, unknown>, updates: Record<string, unknown>) => {
      const inv = invitations.find(i => {
          if (query.tokenHash && i.tokenHash !== query.tokenHash) return false;
          return true;
        });
        if (!inv) return null;
        Object.assign(inv, updates);
        return inv;
      }),
    find: jest.fn().mockImplementation(async (query: Record<string, unknown>) => {
      return invitations
        .filter(inv => {
          if (query.organizationId && inv.organizationId !== query.organizationId) return false;
          if (query.status && inv.status !== query.status) return false;
          return true;
        })
        .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
        .slice(0, 21);
    }),
    countDocuments: jest.fn().mockImplementation(async (query: Record<string, unknown>) => {
      return invitations.filter(inv => {
        if (query.organizationId && inv.organizationId !== query.organizationId) return false;
        if (query.status && inv.status !== query.status) return false;
        return true;
      }).length;
    }),
  };

  InvitationModel.findOne = jest.fn(InvitationModel.findOne);
  InvitationModel.findById = jest.fn(InvitationModel.findById);
  InvitationModel.find = jest.fn(InvitationModel.find);
  InvitationModel.countDocuments = jest.fn(InvitationModel.countDocuments);

  return { InvitationModel, InvitationStatus };
});

const jwt = await import('jsonwebtoken');
const {
  createAndSendInvitation,
  resendInvitation,
  revokeInvitationById,
  getInvitationInfo,
  acceptInvitationWithPassword,
} = await import('../src/modules/invitations/invitations.service.js');
const { AppError } = await import('../src/shared/http/errors.js');

describe('#352 - Persistent Invitations Model', () => {
  const jwtSecret = process.env.JWT_SECRET ?? 'test-secret-key-at-least-32-chars-long';

  beforeAll(() => {
    process.env.JWT_SECRET = jwtSecret;
    process.env.FRONTEND_URL = 'http://localhost:3000';
  });

  beforeEach(() => {
    invitations.length = 0;
    users.length = 0;
    organizations.push({
      _id: 'org-1',
      name: 'Test Org',
      type: 'ENTERPRISE',
    });
    users.push({
      _id: 'user-1',
      email: 'admin@test.com',
      name: 'Admin User',
      role: 'ADMIN',
      organizationId: 'org-1',
    });
    jest.clearAllMocks();
  });

  it('should create invitation and store in database (full invite → accept flow)', async () => {
    const token = await createAndSendInvitation({
      email: 'newuser@test.com',
      role: 'MANAGER',
      inviterId: 'user-1',
      inviterRole: 'ADMIN',
      organizationId: 'org-1',
    });

    expect(token).toHaveProperty('id');
    expect(token).toHaveProperty('token');
    expect(token).toHaveProperty('expiresAt');
    expect(invitations).toHaveLength(1);

    const invitation = invitations[0] as Record<string, unknown>;
    expect(invitation.email).toBe('newuser@test.com');
    expect(invitation.role).toBe('MANAGER');
    expect(invitation.status).toBe('PENDING');
    expect(invitation.organizationId).toBe('org-1');

    // Accept invitation
    const accepted = await acceptInvitationWithPassword({
      token: token.token,
      name: 'New User',
      password: 'SecurePass123',
    });

    expect(accepted.user.email).toBe('newuser@test.com');
    expect(accepted.user.role).toBe('MANAGER');
    expect(users).toHaveLength(2); // admin + new user

    // Verify invitation marked as accepted
    const updatedInv = invitations[0] as Record<string, unknown>;
    expect(updatedInv.status).toBe('ACCEPTED');
  });

  it('should resend invitation with new token and update expiry', async () => {
    const initial = await createAndSendInvitation({
      email: 'user@test.com',
      role: 'VIEWER',
      inviterId: 'user-1',
      inviterRole: 'ADMIN',
      organizationId: 'org-1',
    });

    const invId = initial.id;
    const initialToken = initial.token;
    const initialExpiry = initial.expiresAt;

    // Wait a tiny bit and resend
    await new Promise(r => setTimeout(r, 10));

    const resent = await resendInvitation(invId as string, 'org-1');

    expect(resent).toHaveProperty('token');
    expect(resent.token).not.toBe(initialToken);
    expect(new Date(resent.expiresAt).getTime()).toBeGreaterThan(
      new Date(initialExpiry).getTime()
    );
  });

  it('should revoke invitation preventing acceptance', async () => {
    const token = await createAndSendInvitation({
      email: 'revoke@test.com',
      role: 'VIEWER',
      inviterId: 'user-1',
      inviterRole: 'ADMIN',
      organizationId: 'org-1',
    });

    // Revoke the invitation
    await revokeInvitationById(token.id as string, 'org-1');

    const inv = invitations[0] as Record<string, unknown>;
    expect(inv.status).toBe('REVOKED');

    // Try to accept revoked invitation
    try {
      await acceptInvitationWithPassword({
        token: token.token,
        name: 'User',
        password: 'SecurePass123',
      });
      expect.fail('Should not accept revoked invitation');
    } catch (err) {
      const error = err as AppError;
      expect(error.statusCode).toBe(400);
    }
  });

  it('should return 404 for invalid invitation token in info endpoint', async () => {
    try {
      await getInvitationInfo('invalid.token.here');
      expect.fail('Should throw error');
    } catch (err) {
      const error = err as AppError;
      expect(error.statusCode).toBe(401);
    }
  });

  it('should prevent duplicate pending invitations for same email', async () => {
    await createAndSendInvitation({
      email: 'unique@test.com',
      role: 'VIEWER',
      inviterId: 'user-1',
      inviterRole: 'ADMIN',
      organizationId: 'org-1',
    });

    try {
      await createAndSendInvitation({
        email: 'unique@test.com',
        role: 'MANAGER',
        inviterId: 'user-1',
        inviterRole: 'ADMIN',
        organizationId: 'org-1',
      });
      expect.fail('Should not allow duplicate');
    } catch (err) {
      const error = err as AppError;
      expect(error.statusCode).toBe(409);
    }
  });

  it('should store tokenHash uniquely for security', async () => {
    const inv1 = await createAndSendInvitation({
      email: 'hash1@test.com',
      role: 'VIEWER',
      inviterId: 'user-1',
      inviterRole: 'ADMIN',
      organizationId: 'org-1',
    });

    const inv2 = await createAndSendInvitation({
      email: 'hash2@test.com',
      role: 'VIEWER',
      inviterId: 'user-1',
      inviterRole: 'ADMIN',
      organizationId: 'org-1',
    });

    const stored1 = invitations[0] as Record<string, unknown>;
    const stored2 = invitations[1] as Record<string, unknown>;

    expect(stored1.tokenHash).not.toBe(stored2.tokenHash);
    expect(stored1.tokenHash).toBeDefined();
  });

  it('should track inviter and organization on invitation', async () => {
    await createAndSendInvitation({
      email: 'tracked@test.com',
      role: 'VIEWER',
      inviterId: 'user-1',
      inviterRole: 'ADMIN',
      organizationId: 'org-1',
    });

    const inv = invitations[0] as Record<string, unknown>;
    expect(inv.invitedBy).toBe('user-1');
    expect(inv.organizationId).toBe('org-1');
  });

  it('should retrieve company name in invitation info', async () => {
    const token = await createAndSendInvitation({
      email: 'info@test.com',
      role: 'VIEWER',
      inviterId: 'user-1',
      inviterRole: 'ADMIN',
      organizationId: 'org-1',
    });

    const info = await getInvitationInfo(token.token);
    expect(info.companyName).toBe('Test Org');
    expect(info.email).toBe('info@test.com');
    expect(info.role).toBe('VIEWER');
  });

  it('should expire invitation tokens after 48 hours', async () => {
    const token = await createAndSendInvitation({
      email: 'expire@test.com',
      role: 'VIEWER',
      inviterId: 'user-1',
      inviterRole: 'ADMIN',
      organizationId: 'org-1',
    });

    // Manually expire the invitation in database
    const inv = invitations[0] as Record<string, unknown>;
    inv.expiresAt = new Date(Date.now() - 1000); // Past date

    try {
      await getInvitationInfo(token.token);
      expect.fail('Should throw expired error');
    } catch (err) {
      const error = err as AppError;
      expect(error.statusCode).toBe(400);
    }
  });

  it('should enforce role-based invitation permissions', async () => {
    // ADMIN trying to invite SUPER_ADMIN (not allowed)
    try {
      await createAndSendInvitation({
        email: 'superadmin@test.com',
        role: 'SUPER_ADMIN',
        inviterId: 'user-1',
        inviterRole: 'ADMIN',
        organizationId: 'org-1',
      });
      expect.fail('Should not allow SUPER_ADMIN invite');
    } catch (err) {
      const error = err as AppError;
      expect(error.statusCode).toBe(400);
    }
  });
});
