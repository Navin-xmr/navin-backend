import mongoose from 'mongoose';
import { isoDatePlugin } from '../../shared/plugins/isoDatePlugin.js';
import { IOrganization, OrganizationType } from '../../shared/types/user.js';

const OrganizationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    type: { type: String, enum: Object.values(OrganizationType), required: true },
    settings: { type: mongoose.Schema.Types.Mixed, default: {} },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

OrganizationSchema.plugin(isoDatePlugin);

OrganizationSchema.index({ name: 1 });

OrganizationSchema.pre(['find', 'findOne', 'findOneAndUpdate', 'countDocuments'], function () {
  this.where({ deletedAt: null });
});

OrganizationSchema.pre('aggregate', function () {
  this.pipeline().unshift({ $match: { deletedAt: null } });
});

export const OrganizationModel = mongoose.model<IOrganization>('Organization', OrganizationSchema);
export { OrganizationType };