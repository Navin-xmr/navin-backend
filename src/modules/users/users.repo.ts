import { UserModel } from './users.model.js';

export async function createUser(input: {
  email: string;
  name: string;
  passwordHash?: string;
  role?: string;
  organizationId?: string;
}) {
  return UserModel.create(input);
}

export async function findUserByEmail(email: string) {
  return UserModel.findOne({ email }).lean();
}

export async function findUserById(id: string) {
  return UserModel.findById(id).select('-passwordHash').lean();
}

export async function findUsersByOrganizationId(organizationId: string) {
  return UserModel.find({ organizationId }).select('-passwordHash').lean();
}
