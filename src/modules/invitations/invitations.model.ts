import mongoose from 'mongoose';
import { isoDatePlugin } from '../../shared/plugins/isoDatePlugin.js';

export enum InvitationStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  EXPIRED = 'EXPIRED',
  REVOKED = 'REVOKED',
}

export interface IInvitation {
  _id?: string;
  email: string;
  role: string;
  status: InvitationStatus;
  tokenHash: string;
  expiresAt: Date;
  message?: string;
  invitedBy: string;
  organizationId: string;
  createdAt?: Date;
  updatedAt?: Date;
  deletedAt?: Date | null;
}

const InvitationSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, index: true },
    role: { type: String, required: true },
    status: {
      type: String,
      enum: Object.values(InvitationStatus),
      default: InvitationStatus.PENDING,
      index: true,
    },
    tokenHash: { type: String, required: true, unique: true, index: true },
    expiresAt: { type: Date, required: true, index: true },
    message: { type: String, required: false },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

InvitationSchema.plugin(isoDatePlugin);

// Auto-expire invitations that exceed expiresAt
InvitationSchema.pre(['find', 'findOne', 'findOneAndUpdate', 'countDocuments'], function () {
  this.where({ deletedAt: null });
});

InvitationSchema.pre('aggregate', function () {
  this.pipeline().unshift({ $match: { deletedAt: null } });
});

export const InvitationModel = mongoose.model<IInvitation>('Invitation', InvitationSchema);
