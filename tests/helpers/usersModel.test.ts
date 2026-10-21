import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createMockOrganization, createMockUser } from '../fixtures/factories.js';
import { createModelQuery, createUsersModelMock } from './mocks.js';

describe('shared users and organization model mocks', () => {
  let models: ReturnType<typeof createUsersModelMock>;

  beforeEach(async () => {
    jest.resetModules();
    models = createUsersModelMock();
    await jest.unstable_mockModule('../../src/modules/users/users.model.js', () => models);
    await jest.unstable_mockModule('../../src/modules/organizations/organizations.model.js', () => ({
      OrganizationModel: models.OrganizationModel,
    }));
  });

  it('supports user lookup select/lean chains and directly awaited queries', async () => {
    const user = createMockUser();
    models.UserModel.findOne.mockReturnValue(createModelQuery(user));
    models.UserModel.findById.mockReturnValue(createModelQuery(user));
    const repo = await import('../../src/modules/users/users.repo.js');

    await expect(repo.findUserByEmail(user.email)).resolves.toEqual(user);
    await expect(repo.findUserById(user._id)).resolves.toEqual(user);
    await expect(models.UserModel.findById(user._id)).resolves.toEqual(user);
  });

  it('supports the offset listing query chain and count', async () => {
    const user = createMockUser();
    const query = createModelQuery([user]);
    models.UserModel.find.mockReturnValue(query);
    models.UserModel.countDocuments.mockReturnValue(Promise.resolve(1));
    const repo = await import('../../src/modules/users/users.repo.js');

    await expect(
      repo.findUsersByOrganizationId(user.organizationId, { page: 2, limit: 10 })
    ).resolves.toEqual({ data: [user], total: 1 });
    expect(query.select).toHaveBeenCalledWith('-passwordHash');
    expect(query.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
    expect(query.skip).toHaveBeenCalledWith(10);
    expect(query.limit).toHaveBeenCalledWith(10);
    expect(models.UserModel.find).toHaveBeenCalledWith({
      organizationId: expect.objectContaining({ toHexString: expect.any(Function) }),
    });
  });

  it('supports organization lookup and update lean chains', async () => {
    const organization = createMockOrganization();
    models.OrganizationModel.findById.mockReturnValue(createModelQuery(organization));
    models.OrganizationModel.findOne.mockReturnValue(createModelQuery(organization));
    models.OrganizationModel.findByIdAndUpdate.mockReturnValue(createModelQuery(organization));
    const repo = await import('../../src/modules/organizations/organizations.repo.js');

    await expect(repo.findOrganizationById(organization._id)).resolves.toEqual(organization);
    await expect(repo.findOrganizationByName(organization.name)).resolves.toEqual(organization);
    await expect(
      repo.updateOrganization(organization._id, { name: organization.name })
    ).resolves.toEqual(organization);
    expect(models.OrganizationModel.findByIdAndUpdate).toHaveBeenCalledWith(
      organization._id,
      { name: organization.name },
      { new: true }
    );
  });
});
