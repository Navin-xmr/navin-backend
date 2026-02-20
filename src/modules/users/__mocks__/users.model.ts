// Mock for users.model.ts
export const mockCreate = jest.fn();
export const mockFindOne = jest.fn();

export const UserModel = {
  create: mockCreate,
  findOne: mockFindOne,
};
