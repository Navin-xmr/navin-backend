import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Types } from 'mongoose';
import { createEmailServiceMock, createUsersModelMock } from './helpers/mocks.js';

const ORG_ID = new Types.ObjectId().toHexString();
const INVITER_ID = new Types.ObjectId().toHexString();

// Deterministic organization fixture for the explicit OrganizationModel lookup.
const ORG_FIXTURE = { _id: ORG_ID, name: 'Acme Logistics', type: 'LOGISTICS' };

const mockSendEmail = jest.fn(async () => undefined);

/**
 * Registers every module mock the users service imports (reset → mock → import),
 * so no suite path touches a real database or SMTP transport.
 */
async function loadService() {
  jest.resetModules();

  await jest.unstable_mockModule('../src/modules/users/users.repo.js', () => ({
    createUser: jest.fn(),
    findUserByEmail: jest.fn(async () => null),
    findUserById: jest.fn(),
    findUsersByOrganizationId: jest.fn(),
  }));

  await jest.unstable_mockModule('../src/modules/users/users.model.js', () =>
    createUsersModelMock({
      OrganizationModel: {
        findById: jest.fn(async () => ORG_FIXTURE),
      },
    }),
  );

  await jest.unstable_mockModule('../src/services/email.service.js', () =>
    createEmailServiceMock({ sendEmail: mockSendEmail as never }),
  );

  return import('../src/modules/users/users.service.js');
}

describe('users invitation service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('generates and verifies a token bound to organization and role', async () => {
    const service = await loadService();

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
  });

  it('sends an invitation email to the target address', async () => {
    const service = await loadService();

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
    const service = await loadService();

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
    const service = await loadService();

    const result = await service.generateInvitationLink({
      email: 'linktest@example.com',
      role: 'MANAGER',
      inviterUserId: INVITER_ID,
      inviterRole: 'ADMIN',
      organizationId: ORG_ID,
    });

    const [call] = mockSendEmail.mock.calls as unknown as [[{ html: string }]];
    expect(call[0].html).toContain(result.inviteLink);
    expect(result.inviteLink).toContain('/signup?token=');
  });

  it('rejects invitation creation for forbidden role mapping', async () => {
    const service = await loadService();

    await expect(
      service.generateInvitationLink({
        email: 'admin2@example.com',
        role: 'ADMIN',
        inviterUserId: INVITER_ID,
        inviterRole: 'ADMIN',
        organizationId: ORG_ID,
      }),
    ).rejects.toThrow('Forbidden: insufficient role');
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('rejects invalid invitation tokens', async () => {
    const service = await loadService();

    expect(() => service.verifyInvitationToken('not-a-token')).toThrow(
      'Invalid or expired invitation token',
    );
  });
});
