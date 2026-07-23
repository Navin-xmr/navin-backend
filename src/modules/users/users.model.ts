import { OrganizationType } from '../../shared/types/user.js';
import { UserRole } from '../../shared/constants/index.js';
import { isoDatePlugin } from '../../shared/plugins/isoDatePlugin.js';
import mongoose from 'mongoose';
import { IUser, IOrganization } from '../../shared/types/user.js';

// Re-export OrganizationModel and OrganizationType from organizations module for backward compatibility
export { OrganizationType } from '../../shared/types/user.js';
export { OrganizationModel } from '../organizations/organizations.model.js';

const UserSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: Object.values(UserRole), required: true },
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: false },
    walletAddress: { type: String, required: false },
    deletedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret) => {
        const result = ret as Record<string, unknown>;
        delete result.passwordHash;
        return result;
      },
    },
  }
);

UserSchema.plugin(isoDatePlugin);

// NOTE: Password hashing is performed exclusively in the service layer (auth.service.ts,
// users.service.ts) before calling UserModel.create(). There is intentionally no pre-save
// hook here to avoid double-hashing.

// Override toJSON to hide passwordHash
UserSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.passwordHash;
  return obj;
};

// Soft delete middleware
UserSchema.pre(['find', 'findOne', 'findOneAndUpdate', 'countDocuments'], function () {
  this.where({ deletedAt: null });
});

UserSchema.pre('aggregate', function () {
  this.pipeline().unshift({ $match: { deletedAt: null } });
});

export const UserModel = mongoose.model<IUser>('User', UserSchema);
export { UserRole };
