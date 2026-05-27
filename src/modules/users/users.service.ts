import { AppError } from '../../shared/http/errors.js';
import { createUser, findUserByEmail, findUsersByOrganizationId } from './users.repo.js';
import { UserModel } from './users.model.js';
import { UserRole } from '../../shared/constants/index.js';

export async function registerUser(input: { email: string; name: string }) {
  const existing = await findUserByEmail(input.email);
  if (existing) throw new AppError(409, 'Email already in use', 'EMAIL_TAKEN');
  return createUser(input);
}

export async function listOrganizationUsers(input: {
  organizationId?: string;
  role?: string;
}) {
  const allowedRoles = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER];

  if (!input.role || !allowedRoles.includes(input.role as UserRole)) {
    throw new AppError(403, 'Forbidden: insufficient role', 'FORBIDDEN');
  }

  if (!input.organizationId) {
    throw new AppError(403, 'Organization context is required', 'FORBIDDEN');
  }

  return findUsersByOrganizationId(input.organizationId);
}

export async function deleteUser(id: string) {
  const user = await UserModel.findByIdAndUpdate(id, { deletedAt: new Date() }, { new: true });
  if (!user) throw new AppError(404, 'User not found', 'USER_NOT_FOUND');
  return user;
}
