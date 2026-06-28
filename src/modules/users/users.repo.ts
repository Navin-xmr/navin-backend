import { Types } from 'mongoose';
import { UserModel } from './users.model.js';
import type { IUser } from '../../shared/types/user.js';

export interface UsersPage {
  data: IUser[];
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
}

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

export async function findUsersByOrganizationId(
  organizationId: string,
  filters?: { limit?: number; cursor?: string }
): Promise<UsersPage> {
  const limit = filters?.limit ?? 20;
  const query: Record<string, unknown> = {
    organizationId: new Types.ObjectId(organizationId),
  };

  if (filters?.cursor) {
    query._id = { $lt: new Types.ObjectId(filters.cursor) };
  }

  const [data, total] = await Promise.all([
    UserModel.find(query)
      .select('-passwordHash')
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean(),
    UserModel.countDocuments({ organizationId: new Types.ObjectId(organizationId) }),
  ]);

  const hasMore = data.length > limit;
  if (hasMore) data.pop();

  return {
    data,
    total,
    hasMore,
    nextCursor: hasMore && data.length > 0 ? String(data[data.length - 1]._id) : null,
  };
}
