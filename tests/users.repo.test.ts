import { describe, it, expect, beforeEach, jest } from '@jest/globals';

describe('users.repo', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('findUserByEmail uses UserModel.findOne().lean()', async () => {
    const lean = jest.fn(async () => ({ _id: 'u1', email: 'x@example.com' }));
    const findOne = jest.fn(() => ({ lean }));
    const create = jest.fn();

    await jest.unstable_mockModule('../src/modules/users/users.model.js', () => ({
      UserModel: {
        findOne,
        create,
      },
    }));

    const repo = await import('../src/modules/users/users.repo.js');
    const result = await repo.findUserByEmail('x@example.com');

    expect(findOne).toHaveBeenCalledTimes(1);
    expect(lean).toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ email: 'x@example.com' }));
  });

  it('createUser delegates to UserModel.create', async () => {
    const create = jest.fn(async (payload: { email: string; name: string }) => ({
      _id: 'u2',
      ...payload,
    }));
    const findOne = jest.fn();

    await jest.unstable_mockModule('../src/modules/users/users.model.js', () => ({
      UserModel: {
        findOne,
        create,
      },
    }));

    const repo = await import('../src/modules/users/users.repo.js');
    const result = await repo.createUser({ email: 'new@example.com', name: 'New' });

    expect(create).toHaveBeenCalledWith({ email: 'new@example.com', name: 'New' });
    expect(result).toEqual(expect.objectContaining({ email: 'new@example.com', name: 'New' }));
  });
});
