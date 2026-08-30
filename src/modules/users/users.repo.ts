import { Types } from 'mongoose';
import { UserModel } from './users.model.js';
import type { IUser } from '../../shared/types/user.js';
import { offsetSkip, paginateCursor } from '../../shared/utils/pagination.js';

export interface UsersPage {
  data: IUser[];
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export interface UsersOffsetPage {
  data: IUser[];
  total: number;
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
  const result = UserModel.findOne({ email });
  return typeof (result as { lean?: () => unknown }).lean === 'function'
    ? (result as { lean: () => Promise<unknown> }).lean()
    : result;
}

export async function findUsersByOrganizationId(
  organizationId: string,
  filters?: {
    limit?: number;
    cursor?: string;
    page?: number;
    search?: string;
    role?: string;
  }
): Promise<UsersPage | UsersOffsetPage> {
  const limit = filters?.limit ?? 20;
  const baseQuery: Record<string, unknown> = {
    organizationId: new Types.ObjectId(organizationId),
  };

  // Optional search: case-insensitive match on name or email
  if (filters?.search) {
    const searchRegex = new RegExp(filters.search, 'i');
    baseQuery.$or = [{ name: searchRegex }, { email: searchRegex }];
  }

  // Optional role filter
  if (filters?.role) {
    baseQuery.role = filters.role;
  }

  // Offset pagination (page mode)
  if (filters?.page !== undefined) {
    const skip = offsetSkip(filters.page, limit);
    const [data, total] = await Promise.all([
      UserModel.find(baseQuery)
        .select('-passwordHash')
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      UserModel.countDocuments(baseQuery),
    ]);
    return { data, total } as UsersOffsetPage;
  }

  // Cursor pagination (default)
  const cursorQuery = { ...baseQuery };
  if (filters?.cursor) {
    cursorQuery._id = { $lt: new Types.ObjectId(filters.cursor) };
  }

  const [rawData, total] = await Promise.all([
    UserModel.find(cursorQuery)
      .select('-passwordHash')
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean(),
    UserModel.countDocuments(baseQuery),
  ]);

  const page = paginateCursor(rawData, limit);

  return {
    data: page.data,
    total,
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
  } as UsersPage;
}

export async function findUserById(id: string) {
  const result = UserModel.findById(id).select('-passwordHash');
  return typeof (result as { lean?: () => unknown }).lean === 'function'
    ? (result as { lean: () => Promise<unknown> }).lean()
    : result;
}
