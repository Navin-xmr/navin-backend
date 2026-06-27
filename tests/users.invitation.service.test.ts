import { beforeEach, describe, expect, it, jest } from '@jest/globals';

describe('users invitation service', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('generates and verifies a token bound to organization and role', async () => {
    const findUserByEmail = jest.fn(async () => null);

    await jest.unstable_mockModule('../src/modules/users/users.repo.js', () => ({
      createUser: jest.fn(),
      findUserByEmail,
      findUsersByOrganizationId: jest.fn(),
    }));

    await jest.unstable_mockModule('../src/modules/users/users.model.js', () => ({
      UserModel: {
        findByIdAndUpdate: jest.fn(),
        create: jest.fn(),
      },
    }));

    const service = await import('../src/modules/users/users.service.js');

    const invitation = await service.generateInvitationLink({
      email: 'new.user@example.com',
      role: 'MANAGER',
      inviterUserId: 'admin-1',
      inviterRole: 'ADMIN',
      organizationId: 'org-1',
    });

    expect(invitation.inviteLink).toContain('token=');
    expect(invitation.expiresInSeconds).toBe(172800);

    const verified = service.verifyInvitationToken(invitation.token);
    expect(verified.email).toBe('new.user@example.com');
    expect(verified.role).toBe('MANAGER');
    expect(verified.organizationId).toBe('org-1');
    expect(verified.expiresAt).toBeTruthy();
  });

  it('rejects invitation creation for forbidden role mapping', async () => {
    await jest.unstable_mockModule('../src/modules/users/users.repo.js', () => ({
      createUser: jest.fn(),
      findUserByEmail: jest.fn(async () => null),
      findUsersByOrganizationId: jest.fn(),
    }));

    await jest.unstable_mockModule('../src/modules/users/users.model.js', () => ({
      UserModel: {
        findByIdAndUpdate: jest.fn(),
        create: jest.fn(),
      },
    }));

    const service = await import('../src/modules/users/users.service.js');

    await expect(
      service.generateInvitationLink({
        email: 'admin2@example.com',
        role: 'ADMIN',
        inviterUserId: 'admin-1',
        inviterRole: 'ADMIN',
        organizationId: 'org-1',
      }),
    ).rejects.toThrow('Forbidden: insufficient role');
  });

  it('rejects invalid invitation tokens', async () => {
    await jest.unstable_mockModule('../src/modules/users/users.repo.js', () => ({
      createUser: jest.fn(),
      findUserByEmail: jest.fn(async () => null),
      findUsersByOrganizationId: jest.fn(),
    }));

    await jest.unstable_mockModule('../src/modules/users/users.model.js', () => ({
      UserModel: {
        findByIdAndUpdate: jest.fn(),
        create: jest.fn(),
      },
    }));

    const service = await import('../src/modules/users/users.service.js');

    expect(() => service.verifyInvitationToken('not-a-token')).toThrow(
      'Invalid or expired invitation token',
    );
  });
});
