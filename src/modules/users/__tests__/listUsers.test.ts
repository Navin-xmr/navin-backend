/**
 * Unit tests for GET /api/users — offset pagination, cursor pagination,
 * search filter, role filter, and auth/role guards.
 *
 * Uses jest.unstable_mockModule + dynamic import to satisfy the ESM module
 * system used by this project (ts-jest preset: default-esm).
 */

import { jest } from '@jest/globals';
import { UserRole } from '../../../shared/constants/index.js';

// ---------------------------------------------------------------------------
// Mock users.repo — must be declared before any dynamic import of the service
// ---------------------------------------------------------------------------
const mockFindUsersByOrganizationId = jest.fn();

jest.unstable_mockModule('../users.repo.js', () => ({
  findUsersByOrganizationId: mockFindUsersByOrganizationId,
  createUser: jest.fn(),
  findUserByEmail: jest.fn(),
  findUserById: jest.fn(),
}));

// Mock email service to prevent network calls
jest.unstable_mockModule('../../../services/email.service.js', () => ({
  sendEmail: jest.fn(),
  invitationEmailHtml: jest.fn(() => '<p>invite</p>'),
}));

// ---------------------------------------------------------------------------
// Dynamic imports after mocks are set up
// ---------------------------------------------------------------------------
const { listOrganizationUsers } = await import('../users.service.js');

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------
const ORG_ID = '000000000000000000000001';
const CALLER_ADMIN = { role: UserRole.ADMIN, organizationId: ORG_ID };
const CALLER_VIEWER = { role: UserRole.VIEWER, organizationId: ORG_ID };

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    _id: '000000000000000000000010',
    email: 'alice@example.com',
    name: 'Alice',
    role: UserRole.MANAGER,
    organizationId: ORG_ID,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Offset pagination — correct meta shape
// ---------------------------------------------------------------------------
describe('listOrganizationUsers — offset pagination', () => {
  it('returns { page, limit, total } meta when page param is provided', async () => {
    const users = [
      makeUser(),
      makeUser({ _id: '000000000000000000000011', email: 'bob@example.com', name: 'Bob' }),
    ];

    mockFindUsersByOrganizationId.mockResolvedValueOnce({ data: users, total: 42 });

    const result = await listOrganizationUsers({
      ...CALLER_ADMIN,
      page: 2,
      limit: 20,
    });

    expect(result.isOffsetMode).toBe(true);
    expect(result.data).toHaveLength(2);
    expect(result.page).toBe(2);
    expect(result.limit).toBe(20);
    expect(result.total).toBe(42);
    expect(result.nextCursor).toBeNull();
    expect(result.hasMore).toBe(false);

    expect(mockFindUsersByOrganizationId).toHaveBeenCalledWith(
      ORG_ID,
      expect.objectContaining({ page: 2, limit: 20 })
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Cursor pagination — nextCursor returned
// ---------------------------------------------------------------------------
describe('listOrganizationUsers — cursor pagination', () => {
  it('returns nextCursor and hasMore when cursor mode is used', async () => {
    const users = [makeUser()];
    const NEXT = '000000000000000000000099';

    mockFindUsersByOrganizationId.mockResolvedValueOnce({
      data: users,
      total: 5,
      hasMore: true,
      nextCursor: NEXT,
    });

    const result = await listOrganizationUsers({
      ...CALLER_ADMIN,
      limit: 1,
    });

    expect(result.isOffsetMode).toBe(false);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe(NEXT);
    expect(result.data).toHaveLength(1);
  });

  it('returns nextCursor null on last cursor page', async () => {
    mockFindUsersByOrganizationId.mockResolvedValueOnce({
      data: [makeUser()],
      total: 1,
      hasMore: false,
      nextCursor: null,
    });

    const result = await listOrganizationUsers({ ...CALLER_ADMIN, limit: 20 });

    expect(result.isOffsetMode).toBe(false);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Search filter — forwarded to repo
// ---------------------------------------------------------------------------
describe('listOrganizationUsers — search filter', () => {
  it('forwards search param to repo so result set is reduced', async () => {
    const matching = [makeUser({ email: 'charlie@example.com', name: 'Charlie' })];

    mockFindUsersByOrganizationId.mockResolvedValueOnce({
      data: matching,
      total: 1,
      hasMore: false,
      nextCursor: null,
    });

    const result = await listOrganizationUsers({
      ...CALLER_ADMIN,
      search: 'charlie',
    });

    expect(result.data).toHaveLength(1);
    expect(mockFindUsersByOrganizationId).toHaveBeenCalledWith(
      ORG_ID,
      expect.objectContaining({ search: 'charlie' })
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Role filter — forwarded to repo
// ---------------------------------------------------------------------------
describe('listOrganizationUsers — role filter', () => {
  it('forwards filterRole to the repo query', async () => {
    const drivers = [makeUser({ role: UserRole.DRIVER })];

    mockFindUsersByOrganizationId.mockResolvedValueOnce({
      data: drivers,
      total: 1,
      hasMore: false,
      nextCursor: null,
    });

    const result = await listOrganizationUsers({
      ...CALLER_ADMIN,
      filterRole: UserRole.DRIVER,
    });

    expect(result.data).toHaveLength(1);
    expect(mockFindUsersByOrganizationId).toHaveBeenCalledWith(
      ORG_ID,
      expect.objectContaining({ role: UserRole.DRIVER })
    );
  });
});

// ---------------------------------------------------------------------------
// 5. 401 / no org — missing organizationId
// ---------------------------------------------------------------------------
describe('listOrganizationUsers — auth guard', () => {
  it('throws 403 when organizationId is missing', async () => {
    await expect(
      listOrganizationUsers({ role: UserRole.ADMIN, organizationId: undefined })
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(mockFindUsersByOrganizationId).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 6. 403 — wrong role
// ---------------------------------------------------------------------------
describe('listOrganizationUsers — role guard', () => {
  it('throws 403 when caller has insufficient role (VIEWER)', async () => {
    await expect(listOrganizationUsers({ ...CALLER_VIEWER })).rejects.toMatchObject({
      statusCode: 403,
    });

    expect(mockFindUsersByOrganizationId).not.toHaveBeenCalled();
  });

  it('throws 403 when no role is provided', async () => {
    await expect(
      listOrganizationUsers({ organizationId: ORG_ID, role: undefined })
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
