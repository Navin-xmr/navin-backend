import { Types } from 'mongoose';
import { InvitationModel, type IInvitation, InvitationStatus } from './invitations.model.js';

export interface InvitationsPage {
  data: IInvitation[];
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export async function createInvitation(input: {
  email: string;
  role: string;
  tokenHash: string;
  expiresAt: Date;
  message?: string;
  invitedBy: string;
  organizationId: string;
  status?: InvitationStatus;
}): Promise<IInvitation> {
  return InvitationModel.create({
    ...input,
    status: input.status ?? InvitationStatus.PENDING,
  });
}

export async function findInvitationByTokenHash(tokenHash: string): Promise<IInvitation | null> {
  const result = InvitationModel.findOne({ tokenHash });
  return typeof (result as { lean?: () => Promise<IInvitation | null> }).lean === 'function'
    ? (result as { lean: () => Promise<IInvitation | null> }).lean()
    : result;
}

export async function findInvitationById(id: string): Promise<IInvitation | null> {
  const result = InvitationModel.findById(id);
  return typeof (result as { lean?: () => Promise<IInvitation | null> }).lean === 'function'
    ? (result as { lean: () => Promise<IInvitation | null> }).lean()
    : result;
}

export async function findInvitationsByOrganizationId(
  organizationId: string,
  filters?: { limit?: number; cursor?: string }
): Promise<InvitationsPage> {
  const limit = filters?.limit ?? 20;
  const query: Record<string, unknown> = {
    organizationId: new Types.ObjectId(organizationId),
  };

  if (filters?.cursor) {
    query._id = { $lt: new Types.ObjectId(filters.cursor) };
  }

  const [data, total] = await Promise.all([
    InvitationModel.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean(),
    InvitationModel.countDocuments({ organizationId: new Types.ObjectId(organizationId) }),
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

export async function updateInvitation(
  id: string,
  updates: Partial<IInvitation>
): Promise<IInvitation | null> {
  const result = InvitationModel.findByIdAndUpdate(id, updates, { new: true });
  return typeof (result as { lean?: () => Promise<IInvitation | null> }).lean === 'function'
    ? (result as { lean: () => Promise<IInvitation | null> }).lean()
    : result;
}

export async function updateInvitationByTokenHash(
  tokenHash: string,
  updates: Partial<IInvitation>
): Promise<IInvitation | null> {
  const result = InvitationModel.findOneAndUpdate({ tokenHash }, updates, { new: true });
  return typeof (result as { lean?: () => Promise<IInvitation | null> }).lean === 'function'
    ? (result as { lean: () => Promise<IInvitation | null> }).lean()
    : result;
}

export async function revokeInvitation(id: string): Promise<IInvitation | null> {
  const result = InvitationModel.findByIdAndUpdate(
    id,
    { status: InvitationStatus.REVOKED, updatedAt: new Date() },
    { new: true }
  );
  return typeof (result as { lean?: () => Promise<IInvitation | null> }).lean === 'function'
    ? (result as { lean: () => Promise<IInvitation | null> }).lean()
    : result;
}

export async function softDeleteInvitation(id: string): Promise<IInvitation | null> {
  const result = InvitationModel.findByIdAndUpdate(id, { deletedAt: new Date() }, { new: true });
  return typeof (result as { lean?: () => Promise<IInvitation | null> }).lean === 'function'
    ? (result as { lean: () => Promise<IInvitation | null> }).lean()
    : result;
}
