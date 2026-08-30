import { Schema, model, Types } from 'mongoose';
import { isoDatePlugin } from '../../shared/plugins/isoDatePlugin.js';

export enum PaymentStatus {
  PENDING = 'Pending',
  ESCROWED = 'Escrowed',
  RELEASED = 'Released',
  FAILED = 'Failed',
  DISPUTED = 'Disputed',
}

export interface IEscrowRelease {
  conditionDescription?: string;
  releasedAt?: Date;
  releasedBy?: string;
  disputedAt?: Date;
  disputeReason?: string;
  additionalNotes?: string;
}

export interface IPayment {
  _id: string;
  shipmentId: Types.ObjectId;
  organizationId: Types.ObjectId;
  amount: number;
  /** @deprecated Use `token` instead. Kept for backward compatibility. */
  tokenType: string;
  token: string;
  payerAddress?: string;
  payeeAddress?: string;
  status: PaymentStatus;
  stellarTxHash?: string;
  escrowRelease?: IEscrowRelease;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

const EscrowReleaseSchema = new Schema<IEscrowRelease>(
  {
    conditionDescription: { type: String },
    releasedAt: { type: Date },
    releasedBy: { type: String },
    disputedAt: { type: Date },
    disputeReason: { type: String },
    additionalNotes: { type: String },
  },
  { _id: false }
);

const PaymentSchema = new Schema<IPayment>(
  {
    shipmentId: {
      type: Schema.Types.ObjectId,
      ref: 'Shipment',
      required: true,
    },
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      validate: {
        validator: (v: number) => v > 0,
        message: 'Amount must be positive',
      },
    },
    tokenType: {
      type: String,
      required: false,
      enum: ['XLMN', 'USDC', 'Other'],
    },
    token: {
      type: String,
      required: true,
      enum: ['XLMN', 'USDC', 'Other'],
    },
    payerAddress: { type: String },
    payeeAddress: { type: String },
    status: {
      type: String,
      enum: Object.values(PaymentStatus),
      default: PaymentStatus.PENDING,
    },
    stellarTxHash: { type: String },
    escrowRelease: { type: EscrowReleaseSchema },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

PaymentSchema.plugin(isoDatePlugin);

// Optimizes retrieving payments associated with an organization, sorted by creation date descending (newest first) for invoicing/billing views.
PaymentSchema.index({ organizationId: 1, createdAt: -1 });
PaymentSchema.index({ shipmentId: 1 });
PaymentSchema.index({ status: 1 });
PaymentSchema.index({ stellarTxHash: 1 });

// Soft delete middleware
PaymentSchema.pre(['find', 'findOne', 'findOneAndUpdate', 'countDocuments'], function () {
  this.where({ deletedAt: null });
});

PaymentSchema.pre('aggregate', function () {
  this.pipeline().unshift({ $match: { deletedAt: null } });
});

export const PaymentModel = model<IPayment>('Payment', PaymentSchema);
