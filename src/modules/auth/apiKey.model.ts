import mongoose, { type InferSchemaType } from 'mongoose';

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

ApiKeySchema.index({ keyHash: 1 });
ApiKeySchema.index({ organizationId: 1 });
ApiKeySchema.index({ shipmentId: 1 });

export type ApiKey = InferSchemaType<typeof ApiKeySchema> & { _id: mongoose.Types.ObjectId };
export const ApiKeyModel = mongoose.model<ApiKey>('ApiKey', ApiKeySchema);
