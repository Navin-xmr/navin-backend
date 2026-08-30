import { Schema, model, Types } from 'mongoose';
import { isoDatePlugin } from '../../shared/plugins/isoDatePlugin.js';

export type NotificationType = 'shipments' | 'settlements' | 'system';

export interface INotification {
  _id: string;
  userId: Types.ObjectId;
  type: NotificationType;
  icon?: string;
  title: string;
  badge?: string;
  badgeColor?: string;
  description: string;
  timestamp: Date;
  shipmentId?: Types.ObjectId;
  trackingNumber?: string;
  actionLabel?: string;
  isRead: boolean;
  link?: string;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: {
      type: String,
      enum: ['shipments', 'settlements', 'system'],
      required: true,
      index: true,
    },
    icon: { type: String },
    title: { type: String, required: true },
    badge: { type: String },
    badgeColor: { type: String },
    description: { type: String, required: true },
    timestamp: { type: Date, required: true, index: true },
    shipmentId: { type: Schema.Types.ObjectId, ref: 'Shipment' },
    trackingNumber: { type: String },
    actionLabel: { type: String },
    isRead: { type: Boolean, default: false, index: true },
    link: { type: String },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

NotificationSchema.plugin(isoDatePlugin);

// Optimizes retrieving notifications for a specific user, sorted by timestamp descending
NotificationSchema.index({ userId: 1, timestamp: -1 });

// Optimizes retrieving unread notifications for a user
NotificationSchema.index({ userId: 1, isRead: 1 });

// Optimizes filtering notifications by type for a user
NotificationSchema.index({ userId: 1, type: 1, timestamp: -1 });

// Soft delete middleware
NotificationSchema.pre(['find', 'findOne', 'findOneAndUpdate', 'countDocuments'], function () {
  this.where({ deletedAt: null });
});

NotificationSchema.pre('aggregate', function () {
  this.pipeline().unshift({ $match: { deletedAt: null } });
});

export const NotificationModel = model<INotification>('Notification', NotificationSchema);
