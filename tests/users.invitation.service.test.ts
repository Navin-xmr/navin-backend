import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockSendEmail = jest.fn() as any;

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
      findUserById: jest.fn(),
      findUsersByOrganizationId: jest.fn(),
    }));

    await jest.unstable_mockModule('../src/modules/users/users.model.js', () => ({
      UserModel: {
        findByIdAndUpdate: jest.fn(),
        create: jest.fn(),
      },
    }));

    await jest.unstable_mockModule('../src/services/email.service.js', () => ({
      sendEmail: mockSendEmail,
      resetPasswordEmailHtml: (link: string) => `<html>${link}</html>`,
      invitationEmailHtml: (link: string) => `<html>${link}</html>`,
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

  it('sends an invitation email to the target address', async () => {
    mockSendEmail.mockClear();

    await jest.unstable_mockModule('../src/modules/users/users.repo.js', () => ({
      createUser: jest.fn(),
      findUserByEmail: jest.fn(async () => null),
      findUserById: jest.fn(),
      findUsersByOrganizationId: jest.fn(),
    }));

    await jest.unstable_mockModule('../src/modules/users/users.model.js', () => ({
      UserModel: {
        findByIdAndUpdate: jest.fn(),
        create: jest.fn(),
      },
    }));

    await jest.unstable_mockModule('../src/services/email.service.js', () => ({
      sendEmail: mockSendEmail,
      resetPasswordEmailHtml: (link: string) => `<html>${link}</html>`,
      invitationEmailHtml: (link: string) => `<html>${link}</html>`,
    }));

    const service = await import('../src/modules/users/users.service.js');

    await service.generateInvitationLink({
      email: 'invitee@example.com',
      role: 'VIEWER',
      inviterUserId: 'admin-1',
      inviterRole: 'ADMIN',
      organizationId: 'org-1',
    });

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'invitee@example.com' }),
    );
  });

  it('allows inviting a DRIVER role', async () => {
    await jest.unstable_mockModule('../src/modules/users/users.repo.js', () => ({
      createUser: jest.fn(),
      findUserByEmail: jest.fn(async () => null),
      findUserById: jest.fn(),
      findUsersByOrganizationId: jest.fn(),
    }));

    await jest.unstable_mockModule('../src/modules/users/users.model.js', () => ({
      UserModel: {
        findByIdAndUpdate: jest.fn(),
        create: jest.fn(),
      },
    }));

    await jest.unstable_mockModule('../src/services/email.service.js', () => ({
      sendEmail: mockSendEmail,
      resetPasswordEmailHtml: (link: string) => `<html>${link}</html>`,
      invitationEmailHtml: (link: string) => `<html>${link}</html>`,
    }));

    const service = await import('../src/modules/users/users.service.js');

    await expect(
      service.generateInvitationLink({
        email: 'driver@example.com',
        role: 'DRIVER',
        inviterUserId: 'admin-1',
        inviterRole: 'ADMIN',
        organizationId: 'org-1',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        token: expect.any(String),
      }),
    );
  });

  it('includes a valid invite link in the email body', async () => {
    mockSendEmail.mockClear();

    await jest.unstable_mockModule('../src/modules/users/users.repo.js', () => ({
      createUser: jest.fn(),
      findUserByEmail: jest.fn(async () => null),
      findUserById: jest.fn(),
      findUsersByOrganizationId: jest.fn(),
    }));

    await jest.unstable_mockModule('../src/modules/users/users.model.js', () => ({
      UserModel: {
        findByIdAndUpdate: jest.fn(),
        create: jest.fn(),
      },
    }));

    await jest.unstable_mockModule('../src/services/email.service.js', () => ({
      sendEmail: mockSendEmail,
      resetPasswordEmailHtml: (link: string) => `<html>${link}</html>`,
      invitationEmailHtml: (link: string) => `<html>${link}</html>`,
    }));

    const service = await import('../src/modules/users/users.service.js');

    const result = await service.generateInvitationLink({
      email: 'linktest@example.com',
      role: 'MANAGER',
      inviterUserId: 'admin-1',
      inviterRole: 'ADMIN',
      organizationId: 'org-1',
    });

    const call = (mockSendEmail.mock.calls as any)[0] as [{ to: string; subject: string; html: string }];
    expect(call[0].html).toContain(result.inviteLink);
    expect(result.inviteLink).toContain('/signup?token=');
  });

  it('rejects invitation creation for forbidden role mapping', async () => {
    await jest.unstable_mockModule('../src/modules/users/users.repo.js', () => ({
      createUser: jest.fn(),
      findUserByEmail: jest.fn(async () => null),
      findUserById: jest.fn(),
      findUsersByOrganizationId: jest.fn(),
    }));

    await jest.unstable_mockModule('../src/modules/users/users.model.js', () => ({
      UserModel: {
        findByIdAndUpdate: jest.fn(),
        create: jest.fn(),
      },
    }));

    await jest.unstable_mockModule('../src/services/email.service.js', () => ({
      sendEmail: mockSendEmail,
      resetPasswordEmailHtml: (link: string) => `<html>${link}</html>`,
      invitationEmailHtml: (link: string) => `<html>${link}</html>`,
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
      findUserById: jest.fn(),
      findUsersByOrganizationId: jest.fn(),
    }));

    await jest.unstable_mockModule('../src/modules/users/users.model.js', () => ({
      UserModel: {
        findByIdAndUpdate: jest.fn(),
        create: jest.fn(),
      },
    }));

    await jest.unstable_mockModule('../src/services/email.service.js', () => ({
      sendEmail: mockSendEmail,
      resetPasswordEmailHtml: (link: string) => `<html>${link}</html>`,
      invitationEmailHtml: (link: string) => `<html>${link}</html>`,
    }));

    const service = await import('../src/modules/users/users.service.js');

    expect(() => service.verifyInvitationToken('not-a-token')).toThrow(
      'Invalid or expired invitation token',
    );
  });
});
