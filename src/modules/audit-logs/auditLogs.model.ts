import { Schema, Types, model } from 'mongoose';
import { isoDatePlugin } from '../../shared/plugins/isoDatePlugin.js';

export interface IAuditLog {
  _id: string;
  userId: string;
  action: string;
  resource: string;
  resourceId: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const AuditLogSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: 'User', required: true },
    action: { type: String, required: true, trim: true },
    resource: { type: String, required: true, trim: true },
    resourceId: { type: String, required: true, trim: true },
    timestamp: { type: Date, required: true },
    metadata: { type: Schema.Types.Mixed },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, strict: true }
);

AuditLogSchema.plugin(isoDatePlugin);

AuditLogSchema.index({ timestamp: -1, _id: -1 });
AuditLogSchema.index({ userId: 1, timestamp: -1, _id: -1 });
AuditLogSchema.index({ action: 1, timestamp: -1, _id: -1 });
AuditLogSchema.index({ resource: 1, timestamp: -1, _id: -1 });
AuditLogSchema.index({ resourceId: 1, timestamp: -1, _id: -1 });

AuditLogSchema.pre(['find', 'findOne', 'findOneAndUpdate', 'countDocuments'], function () {
  this.where({ deletedAt: null });
});

AuditLogSchema.pre('aggregate', function () {
  this.pipeline().unshift({ $match: { deletedAt: null } });
});

export const AuditLog = model<IAuditLog>('AuditLog', AuditLogSchema);
