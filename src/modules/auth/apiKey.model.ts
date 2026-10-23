import mongoose from 'mongoose';
import { isoDatePlugin } from '../../shared/plugins/isoDatePlugin.js';
import { IApiKey } from '../../shared/types/apiKey.js';

const ApiKeySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    keyHash: { type: String, required: true, unique: true },
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    shipmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shipment', required: false },
    isActive: { type: Boolean, default: true },
    lastUsedAt: { type: Date },
  },
  { timestamps: true }
);

ApiKeySchema.plugin(isoDatePlugin);

ApiKeySchema.index({ organizationId: 1 });
ApiKeySchema.index({ shipmentId: 1 });

export const ApiKeyModel = mongoose.model<IApiKey>('ApiKey', ApiKeySchema);
