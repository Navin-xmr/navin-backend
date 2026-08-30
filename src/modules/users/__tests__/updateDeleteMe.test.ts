/**
 * Unit tests for PATCH /api/users/me and DELETE /api/users/me.
 *
 * Uses jest.unstable_mockModule + dynamic import to satisfy the ESM module
 * system used by this project (ts-jest preset: default-esm).
 */

import { jest } from '@jest/globals';
import { UserRole } from '../../../shared/constants/index.js';

// ---------------------------------------------------------------------------
// Mock users.repo — must be declared before any dynamic import of the service
// ---------------------------------------------------------------------------
const mockFindUserByEmail = jest.fn();
const mockFindUserById = jest.fn();

jest.unstable_mockModule('../users.repo.js', () => ({
  findUserByEmail: mockFindUserByEmail,
  findUserById: mockFindUserById,
  createUser: jest.fn(),
  findUsersByOrganizationId: jest.fn(),
}));

// Mock organizations.repo
const mockUpdateOrganization = jest.fn();

jest.unstable_mockModule('../../organizations/organizations.repo.js', () => ({
  updateOrganization: mockUpdateOrganization,
  findOrganizationById: jest.fn(),
  findOrganizationByName: jest.fn(),
  createOrganization: jest.fn(),
  listOrganizations: jest.fn(),
  deleteOrganization: jest.fn(),
}));

// Mock token blocklist
const mockBlockToken = jest.fn();

jest.unstable_mockModule('../../../infra/redis/tokenBlocklist.js', () => ({
  blockToken: mockBlockToken,
  isTokenBlocked: jest.fn(),
  BLOCKLIST_PREFIX: 'blocklist:uuid:',
  isValidJti: jest.fn(),
}));

// Mock auth.service for verifyToken
jest.unstable_mockModule('../../auth/auth.service.js', () => ({
  verifyToken: jest.fn(),
  signup: jest.fn(),
  login: jest.fn(),
  refreshToken: jest.fn(),
  logout: jest.fn(),
  setup2fa: jest.fn(),
  registerCompany: jest.fn(),
  changePassword: jest.fn(),
  forgotPassword: jest.fn(),
  resetPassword: jest.fn(),
}));

// Mock email service to prevent network calls
jest.unstable_mockModule('../../../services/email.service.js', () => ({
  sendEmail: jest.fn(),
  invitationEmailHtml: jest.fn(() => '<p>invite</p>'),
}));

// ---------------------------------------------------------------------------
// Dynamic imports after mocks are set up
// ---------------------------------------------------------------------------
const { updateCurrentUser, deleteCurrentUser } = await import('../users.service.js');
const { verifyToken } = await import('../../auth/auth.service.js');

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------
const USER_ID = '000000000000000000000001';
const ORG_ID = '000000000000000000000010';

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    _id: USER_ID,
    email: 'user@example.com',
    name: 'Test User',
    role: UserRole.VIEWER,
    organizationId: ORG_ID,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// PATCH /api/users/me — updateCurrentUser
// ---------------------------------------------------------------------------
describe('updateCurrentUser', () => {
  it('updates name and email successfully', async () => {
    const user = makeUser();
    const UserModel = (await import('../users.model.js')).UserModel;
    UserModel.findById = jest.fn().mockResolvedValueOnce(user);
    mockFindUserByEmail.mockResolvedValueOnce(null);
    mockFindUserById.mockResolvedValueOnce({
      _id: USER_ID,
      email: 'new@example.com',
      name: 'New Name',
      role: UserRole.VIEWER,
      organizationId: ORG_ID,
    });

    const result = await updateCurrentUser(USER_ID, {
      fullName: 'New Name',
      email: 'new@example.com',
    });

    expect(user.name).toBe('New Name');
    expect(user.email).toBe('new@example.com');
    expect(user.save).toHaveBeenCalled();
    expect(mockFindUserByEmail).toHaveBeenCalledWith('new@example.com');
    expect(result).toMatchObject({
      _id: USER_ID,
      email: 'new@example.com',
      name: 'New Name',
    });
  });

  it('updates companyName when user is ADMIN', async () => {
    const user = makeUser({ role: UserRole.ADMIN });
    const UserModel = (await import('../users.model.js')).UserModel;
    UserModel.findById = jest.fn().mockResolvedValueOnce(user);
    mockFindUserById.mockResolvedValueOnce({
      _id: USER_ID,
      email: 'user@example.com',
      name: 'Test User',
      role: UserRole.ADMIN,
      organizationId: ORG_ID,
    });

    const result = await updateCurrentUser(USER_ID, {
      companyName: 'New Company Name',
    });

    expect(mockUpdateOrganization).toHaveBeenCalledWith(ORG_ID, { name: 'New Company Name' });
    expect(user.save).toHaveBeenCalled();
    expect(result).toMatchObject({
      _id: USER_ID,
      role: UserRole.ADMIN,
    });
  });

  it('updates companyName when user is SUPER_ADMIN', async () => {
    const user = makeUser({ role: UserRole.SUPER_ADMIN });
    const UserModel = (await import('../users.model.js')).UserModel;
    UserModel.findById = jest.fn().mockResolvedValueOnce(user);
    mockFindUserById.mockResolvedValueOnce({
      _id: USER_ID,
      email: 'user@example.com',
      name: 'Test User',
      role: UserRole.SUPER_ADMIN,
      organizationId: ORG_ID,
    });

    const result = await updateCurrentUser(USER_ID, {
      companyName: 'New Company Name',
    });

    expect(mockUpdateOrganization).toHaveBeenCalledWith(ORG_ID, { name: 'New Company Name' });
    expect(user.save).toHaveBeenCalled();
    expect(result).toMatchObject({
      _id: USER_ID,
      role: UserRole.SUPER_ADMIN,
    });
  });

  it('throws 403 when non-admin tries to update companyName', async () => {
    const user = makeUser({ role: UserRole.VIEWER });
    const UserModel = (await import('../users.model.js')).UserModel;
    UserModel.findById = jest.fn().mockResolvedValueOnce(user);

    await expect(
      updateCurrentUser(USER_ID, { companyName: 'New Company Name' })
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(mockUpdateOrganization).not.toHaveBeenCalled();
  });

  it('throws 404 when user not found', async () => {
    const UserModel = (await import('../users.model.js')).UserModel;
    UserModel.findById = jest.fn().mockResolvedValueOnce(null);

    await expect(updateCurrentUser(USER_ID, { fullName: 'New Name' })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('throws 409 when email is already taken', async () => {
    const user = makeUser();
    const UserModel = (await import('../users.model.js')).UserModel;
    UserModel.findById = jest.fn().mockResolvedValueOnce(user);
    mockFindUserByEmail.mockResolvedValueOnce({
      _id: '000000000000000000000099',
      email: 'taken@example.com',
    });

    await expect(updateCurrentUser(USER_ID, { email: 'taken@example.com' })).rejects.toMatchObject({
      statusCode: 409,
    });
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/users/me — deleteCurrentUser
// ---------------------------------------------------------------------------
describe('deleteCurrentUser', () => {
  it('soft-deletes user and blocklists token', async () => {
    const UserModel = (await import('../users.model.js')).UserModel;
    UserModel.findByIdAndUpdate = jest.fn().mockResolvedValueOnce({
      _id: USER_ID,
      email: 'user@example.com',
      name: 'Test User',
      deletedAt: new Date(),
    });

    (verifyToken as jest.Mock).mockReturnValueOnce({
      jti: '550e8400-e29b-41d4-a716-446655440000',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const result = await deleteCurrentUser(USER_ID, 'valid-token');

    expect(UserModel.findByIdAndUpdate).toHaveBeenCalledWith(
      USER_ID,
      { deletedAt: expect.any(Date) },
      { new: true }
    );
    expect(mockBlockToken).toHaveBeenCalledWith(
      '550e8400-e29b-41d4-a716-446655440000',
      expect.any(Number)
    );
    expect(result).toMatchObject({ _id: USER_ID });
  });

  it('throws 404 when user not found', async () => {
    const UserModel = (await import('../users.model.js')).UserModel;
    UserModel.findByIdAndUpdate = jest.fn().mockResolvedValueOnce(null);

    await expect(deleteCurrentUser(USER_ID, 'valid-token')).rejects.toMatchObject({
      statusCode: 404,
    });

    expect(mockBlockToken).not.toHaveBeenCalled();
  });

  it('soft-deletes user even if token is invalid', async () => {
    const UserModel = (await import('../users.model.js')).UserModel;
    UserModel.findByIdAndUpdate = jest.fn().mockResolvedValueOnce({
      _id: USER_ID,
      email: 'user@example.com',
      name: 'Test User',
      deletedAt: new Date(),
    });

    (verifyToken as jest.Mock).mockImplementationOnce(() => {
      throw new Error('Invalid token');
    });

    const result = await deleteCurrentUser(USER_ID, 'invalid-token');

    expect(UserModel.findByIdAndUpdate).toHaveBeenCalledWith(
      USER_ID,
      { deletedAt: expect.any(Date) },
      { new: true }
    );
    expect(mockBlockToken).not.toHaveBeenCalled();
    expect(result).toMatchObject({ _id: USER_ID });
  });
});
