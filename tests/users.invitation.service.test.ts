import { describe, expect, it, jest } from '@jest/globals';
import {
  createEmailServiceMock,
  createUsersModelMock,
  createUsersRepoMock,
} from './helpers/mocks.js';
import { createMockOrganization, createMockUser } from './fixtures/factories.js';
import type * as OrganizationsRepo from '../src/modules/organizations/organizations.repo.js';
import type * as AuthService from '../src/modules/auth/auth.service.js';
import type * as TokenBlocklist from '../src/infra/redis/tokenBlocklist.js';
import type { AuditLogParams } from '../src/shared/utils/auditLog.js';
import type { sendEmail } from '../src/services/email.service.js';

const organization = createMockOrganization();
const inviter = createMockUser({ organizationId: organization._id });
const ORG_ID = organization._id;
const INVITER_ID = inviter._id;

/**
 * Registers every module mock the users service imports (reset → mock → import),
 * so no suite path touches a real database or SMTP transport.
 */
async function loadService() {
  jest.resetModules();

  const usersRepo = createUsersRepoMock();
  const usersModel = createUsersModelMock();
  const mockSendEmail = jest.fn<typeof sendEmail>().mockResolvedValue(undefined);
  const auditLog = jest.fn<(_params: AuditLogParams) => void>();
  const organizationsRepo: jest.Mocked<typeof OrganizationsRepo> = {
    createOrganization: jest.fn<typeof OrganizationsRepo.createOrganization>(),
    findOrganizationById: jest.fn<typeof OrganizationsRepo.findOrganizationById>(),
    findOrganizationByName: jest.fn<typeof OrganizationsRepo.findOrganizationByName>(),
    listOrganizations: jest.fn<typeof OrganizationsRepo.listOrganizations>(),
    updateOrganization: jest.fn<typeof OrganizationsRepo.updateOrganization>(),
    deleteOrganization: jest.fn<typeof OrganizationsRepo.deleteOrganization>(),
  };

  await jest.unstable_mockModule('../src/modules/users/users.repo.js', () => usersRepo);
  await jest.unstable_mockModule('../src/modules/users/users.model.js', () => usersModel);
  await jest.unstable_mockModule('../src/modules/organizations/organizations.repo.js', () => organizationsRepo);
  // These imports belong to other users-service paths. Keep their provider graphs inert here.
  await jest.unstable_mockModule('../src/modules/auth/auth.service.js', () => ({
    signup: jest.fn<typeof AuthService.signup>(),
    login: jest.fn<typeof AuthService.login>(),
    verifyToken: jest.fn<typeof AuthService.verifyToken>(),
    refreshToken: jest.fn<typeof AuthService.refreshToken>(),
    logout: jest.fn<typeof AuthService.logout>(),
    forgotPassword: jest.fn<typeof AuthService.forgotPassword>(),
    resetPassword: jest.fn<typeof AuthService.resetPassword>(),
    registerCompany: jest.fn<typeof AuthService.registerCompany>(),
    changePassword: jest.fn<typeof AuthService.changePassword>(),
    setup2fa: jest.fn<typeof AuthService.setup2fa>(),
  } satisfies jest.Mocked<typeof AuthService>));
  await jest.unstable_mockModule('../src/infra/redis/tokenBlocklist.js', () => ({
    BLOCKLIST_PREFIX: 'blocklist:uuid:',
    isValidJti: jest.fn<typeof TokenBlocklist.isValidJti>(),
    blockToken: jest.fn<typeof TokenBlocklist.blockToken>(),
    isTokenBlocked: jest.fn<typeof TokenBlocklist.isTokenBlocked>(),
  }));
  // Real ObjectIds would otherwise let auditLog persist a MongoDB record.
  await jest.unstable_mockModule('../src/shared/utils/auditLog.js', () => ({ auditLog }));

  await jest.unstable_mockModule('../src/services/email.service.js', () =>
    createEmailServiceMock({ sendEmail: mockSendEmail }),
  );

  const service = await import('../src/modules/users/users.service.js');
  return { service, usersRepo, usersModel, organizationsRepo, mockSendEmail, auditLog };
}

describe('users invitation service', () => {
  it('generates and verifies a token bound to organization and role', async () => {
    const { service, usersRepo, usersModel, organizationsRepo, auditLog } = await loadService();
    usersRepo.findUserByEmail.mockResolvedValueOnce(null);

    const invitation = await service.generateInvitationLink({
      email: 'new.user@example.com',
      role: 'MANAGER',
      inviterUserId: INVITER_ID,
      inviterRole: 'ADMIN',
      organizationId: ORG_ID,
    });

    expect(invitation.inviteLink).toContain('token=');
    expect(invitation.expiresInSeconds).toBe(172800);

    const verified = service.verifyInvitationToken(invitation.token);
    expect(verified.email).toBe('new.user@example.com');
    expect(verified.role).toBe('MANAGER');
    expect(verified.organizationId).toBe(ORG_ID);
    expect(verified.expiresAt).toBeTruthy();
    expect(usersRepo.findUserByEmail).toHaveBeenCalledWith('new.user@example.com');
    expect(usersRepo.findUserByEmail).toHaveBeenCalledTimes(1);
    expect(usersModel.OrganizationModel.findById).not.toHaveBeenCalled();
    expect(organizationsRepo.findOrganizationById).not.toHaveBeenCalled();
    expect(organizationsRepo.updateOrganization).not.toHaveBeenCalled();
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({
      userId: INVITER_ID,
      action: 'USER_INVITED',
      metadata: {
        invitedEmail: 'new.user@example.com', role: 'MANAGER', organizationId: ORG_ID,
      },
    }));
  });

  it('sends an invitation email to the target address', async () => {
    const { service, usersRepo, mockSendEmail } = await loadService();
    usersRepo.findUserByEmail.mockResolvedValueOnce(null);

    await service.generateInvitationLink({
      email: 'invitee@example.com',
      role: 'VIEWER',
      inviterUserId: INVITER_ID,
      inviterRole: 'ADMIN',
      organizationId: ORG_ID,
    });

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'invitee@example.com' }),
    );
  });

  it('allows inviting a DRIVER role', async () => {
    const { service, usersRepo } = await loadService();
    usersRepo.findUserByEmail.mockResolvedValueOnce(null);

    await expect(
      service.generateInvitationLink({
        email: 'driver@example.com',
        role: 'DRIVER',
        inviterUserId: INVITER_ID,
        inviterRole: 'ADMIN',
        organizationId: ORG_ID,
      }),
    ).resolves.toEqual(expect.objectContaining({ token: expect.any(String) }));
  });

  it('includes a valid invite link in the email body', async () => {
    const { service, usersRepo, mockSendEmail } = await loadService();
    usersRepo.findUserByEmail.mockResolvedValueOnce(null);

    const result = await service.generateInvitationLink({
      email: 'linktest@example.com',
      role: 'MANAGER',
      inviterUserId: INVITER_ID,
      inviterRole: 'ADMIN',
      organizationId: ORG_ID,
    });

    const [call] = mockSendEmail.mock.calls;
    expect(call[0].html).toContain(result.inviteLink);
    expect(result.inviteLink).toContain('/signup?token=');
  });

  it('rejects invitation creation for forbidden role mapping', async () => {
    const { service, usersRepo, organizationsRepo, mockSendEmail, auditLog } = await loadService();

    await expect(
      service.generateInvitationLink({
        email: 'admin2@example.com',
        role: 'ADMIN',
        inviterUserId: INVITER_ID,
        inviterRole: 'ADMIN',
        organizationId: ORG_ID,
      }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    expect(usersRepo.findUserByEmail).not.toHaveBeenCalled();
    expect(organizationsRepo.findOrganizationById).not.toHaveBeenCalled();
    expect(organizationsRepo.updateOrganization).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('rejects invalid invitation tokens', async () => {
    const { service, usersRepo, usersModel, organizationsRepo, mockSendEmail } = await loadService();

    expect(() => service.verifyInvitationToken('not-a-token')).toThrow(
      'Invalid or expired invitation token',
    );
    await expect(service.acceptInvitation({
      token: 'not-a-token', name: 'New User', password: 'SecurePass123!',
    })).rejects.toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
    expect(usersRepo.findUserByEmail).not.toHaveBeenCalled();
    expect(usersModel.UserModel.create).not.toHaveBeenCalled();
    expect(organizationsRepo.findOrganizationById).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('accepts an invitation using only explicitly arranged user operations', async () => {
    const { service, usersRepo, usersModel, organizationsRepo } = await loadService();
    const user = createMockUser({ email: 'accepted@example.com', organizationId: ORG_ID });
    usersRepo.findUserByEmail.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    usersModel.UserModel.create.mockImplementationOnce(async () => user);
    const invitation = await service.generateInvitationLink({
      email: user.email, role: user.role, inviterUserId: INVITER_ID,
      inviterRole: 'ADMIN', organizationId: ORG_ID,
    });

    await expect(service.acceptInvitation({
      token: invitation.token, name: user.name, password: 'SecurePass123!',
    })).resolves.toBe(user);
    expect(usersRepo.findUserByEmail.mock.calls).toEqual([[user.email], [user.email]]);
    expect(usersModel.UserModel.create).toHaveBeenCalledWith({
      email: user.email,
      name: user.name,
      passwordHash: expect.stringMatching(/^\$2[aby]\$/),
      role: user.role,
      organizationId: ORG_ID,
    });
    expect(usersModel.OrganizationModel.findById).not.toHaveBeenCalled();
    expect(organizationsRepo.findOrganizationById).not.toHaveBeenCalled();
  });

  it('rejects an existing email before sending an invitation', async () => {
    const { service, usersRepo, mockSendEmail, auditLog } = await loadService();
    const existingUser = createMockUser({ email: 'existing@example.com', organizationId: ORG_ID });
    usersRepo.findUserByEmail.mockResolvedValueOnce(existingUser);

    await expect(service.generateInvitationLink({
      email: existingUser.email,
      role: 'VIEWER',
      inviterUserId: INVITER_ID,
      inviterRole: 'ADMIN',
      organizationId: ORG_ID,
    })).rejects.toMatchObject({ statusCode: 409, code: 'EMAIL_TAKEN' });
    expect(usersRepo.findUserByEmail).toHaveBeenCalledWith(existingUser.email);
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('rejects absent organization context before any repository lookup', async () => {
    const { service, usersRepo, organizationsRepo, mockSendEmail } = await loadService();
    await expect(service.generateInvitationLink({
      email: 'invitee@example.com', role: 'VIEWER', inviterUserId: INVITER_ID, inviterRole: 'ADMIN',
    })).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    expect(usersRepo.findUserByEmail).not.toHaveBeenCalled();
    expect(organizationsRepo.findOrganizationById).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('rejects SUPER_ADMIN invitations before any repository lookup', async () => {
    const { service, usersRepo, mockSendEmail } = await loadService();
    await expect(service.generateInvitationLink({
      email: 'invitee@example.com', role: 'SUPER_ADMIN', inviterUserId: INVITER_ID,
      inviterRole: 'ADMIN', organizationId: ORG_ID,
    })).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_ROLE' });
    expect(usersRepo.findUserByEmail).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});
