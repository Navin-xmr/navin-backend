import { Schema, model, Types } from 'mongoose';
import { isoDatePlugin } from '../../shared/plugins/isoDatePlugin.js';

export type NotificationEvent =
  | 'shipment_created'
  | 'status_changed'
  | 'delivery_confirmed'
  | 'payment_received'
  | 'dispute_opened'
  | 'dispute_resolved';

export type NotificationChannel = 'email' | 'sms';

export interface INotificationPreference {
  _id: string;
  userId: Types.ObjectId;
  event: NotificationEvent;
  channel: NotificationChannel;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationPreferenceSchema = new Schema<INotificationPreference>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    event: {
      type: String,
      enum: [
        'shipment_created',
        'status_changed',
        'delivery_confirmed',
        'payment_received',
        'dispute_opened',
        'dispute_resolved',
      ],
      required: true,
    },
    channel: {
      type: String,
      enum: ['email', 'sms'],
      required: true,
    },
    enabled: { type: Boolean, default: true },
  },
  { timestamps: true }
);

NotificationPreferenceSchema.plugin(isoDatePlugin);

// Ensures one preference per userId+event+channel combination
NotificationPreferenceSchema.index({ userId: 1, event: 1, channel: 1 }, { unique: true });

export const NotificationPreferenceModel = model<INotificationPreference>(
  'NotificationPreference',
  NotificationPreferenceSchema
);
