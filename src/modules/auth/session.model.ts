import mongoose from 'mongoose';
import { isoDatePlugin } from '../../shared/plugins/isoDatePlugin.js';

export interface ISession {
  _id: string;
  userId: mongoose.Types.ObjectId | string;
  jti: string;
  ip?: string;
  userAgent?: string;
  createdAt: Date;
  lastUsedAt: Date;
}

const SessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    jti: { type: String, required: true, unique: true, index: true },
    ip: { type: String, required: false },
    userAgent: { type: String, required: false },
    lastUsedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

SessionSchema.plugin(isoDatePlugin);

SessionSchema.index({ userId: 1, createdAt: -1 });

export const SessionModel = mongoose.model<ISession>('Session', SessionSchema);
