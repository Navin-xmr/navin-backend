import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { AppError } from '../src/shared/http/errors.js';

describe('users service and repo', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('registerUser creates user when email is not taken', async () => {
    const createUser = jest.fn(async (input: { email: string; name: string }) => ({
      _id: 'u1',
      ...input,
    }));
    const findUserByEmail = jest.fn(async () => null);

    await jest.unstable_mockModule('../src/modules/users/users.repo.js', () => ({
      createUser,
      findUserByEmail,
    }));

    const { registerUser } = await import('../src/modules/users/users.service.js');
    const result = await registerUser({ email: 'new@example.com', name: 'New User' });

    expect(findUserByEmail).toHaveBeenCalledTimes(1);
    expect(createUser).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({ email: 'new@example.com' }));
  });

  it('registerUser throws when email is already in use', async () => {
    const createUser = jest.fn();
    const findUserByEmail = jest.fn(async () => ({ _id: 'u1', email: 'existing@example.com' }));

    await jest.unstable_mockModule('../src/modules/users/users.repo.js', () => ({
      createUser,
      findUserByEmail,
    }));

    const { registerUser } = await import('../src/modules/users/users.service.js');

    await expect(
      registerUser({ email: 'existing@example.com', name: 'Existing' })
    ).rejects.toThrow('Email already in use');
    expect(createUser).not.toHaveBeenCalled();
  });
});
