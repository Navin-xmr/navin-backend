import mongoose, { Schema } from 'mongoose';
import { CHAIN_EVENT_NAMES } from '../../shared/types/chain.js';
import { isoDatePlugin } from '../../shared/plugins/isoDatePlugin.js';

export interface ChainWebhookSubscription {
  _id: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  endpoint: string;
  events: string[];
  secretEncrypted: string;
  isActive: boolean;
  createdBy: mongoose.Types.ObjectId;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Stores organization-scoped subscriber endpoints and encrypted signing credentials. */
const ChainWebhookSubscriptionSchema = new Schema<ChainWebhookSubscription>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
    },
    endpoint: { type: String, required: true },
    events: {
      type: [String],
      enum: Object.values(CHAIN_EVENT_NAMES),
      required: true,
    },
    secretEncrypted: { type: String, required: true, select: false },
    isActive: { type: Boolean, required: true, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

ChainWebhookSubscriptionSchema.plugin(isoDatePlugin);
ChainWebhookSubscriptionSchema.index({ organizationId: 1, isActive: 1 });
ChainWebhookSubscriptionSchema.index({ endpoint: 1, organizationId: 1 }, { unique: true });

ChainWebhookSubscriptionSchema.pre(
  ['find', 'findOne', 'findOneAndUpdate', 'countDocuments'],
  function () {
    this.where({ deletedAt: null });
  }
);
ChainWebhookSubscriptionSchema.pre('aggregate', function () {
  this.pipeline().unshift({ $match: { deletedAt: null } });
});

const existingChainWebhookSubscriptionModel = mongoose.models.ChainWebhookSubscription as
  mongoose.Model<ChainWebhookSubscription> | undefined;

export const ChainWebhookSubscriptionModel =
  existingChainWebhookSubscriptionModel ??
  mongoose.model<ChainWebhookSubscription>(
    'ChainWebhookSubscription',
    ChainWebhookSubscriptionSchema
  );
