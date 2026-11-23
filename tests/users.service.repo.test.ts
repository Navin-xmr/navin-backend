import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { mockModule } from './helpers/mockFactory.js';

// NOTE: mocks are registered ONCE at module scope (resetModules →
// unstable_mockModule → dynamic import). Re-registering per test does not
// re-isolate under --experimental-vm-modules: dynamic re-imports resolve from
// the stale registry, so later tests silently run against earlier mocks.
const createUser = jest.fn();
const findUserByEmail = jest.fn();
const findUsersByOrganizationId = jest.fn();

jest.resetModules();

await mockModule('../src/modules/users/users.repo.js', {
  createUser,
  findUserByEmail,
  findUsersByOrganizationId,
});

const { registerUser } = await import('../src/modules/users/users.service.js');

describe('users service and repo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registerUser creates user when email is not taken', async () => {
    findUserByEmail.mockResolvedValue(null);
    findUsersByOrganizationId.mockResolvedValue([]);
    createUser.mockImplementation(async (input: { email: string; name: string }) => ({
      _id: 'u1',
      ...input,
    }));

    const result = await registerUser({ email: 'new@example.com', name: 'New User' });

    expect(findUserByEmail).toHaveBeenCalledTimes(1);
    expect(createUser).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({ email: 'new@example.com' }));
  });

  it('registerUser throws when email is already in use', async () => {
    findUserByEmail.mockResolvedValue({ _id: 'u1', email: 'existing@example.com' });
    findUsersByOrganizationId.mockResolvedValue([]);

    await expect(
      registerUser({ email: 'existing@example.com', name: 'Existing' })
    ).rejects.toThrow('Email already in use');
    expect(createUser).not.toHaveBeenCalled();
  });
});
