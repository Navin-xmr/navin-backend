import { Schema, model, Types } from 'mongoose';
import { isoDatePlugin } from '../../shared/plugins/isoDatePlugin.js';

/**
 * Deployment a mapping belongs to. The contract allocates `u64` shipment ids per
 * deployment, so `testnet` and `public` are independent keyspaces — the same
 * shipment gets one mapping row per network the backend has pushed it to.
 */
export type ChainNetwork = 'testnet' | 'public';

/**
 * P11-10 — mapping between a MongoDB shipment identity and the contract's
 * auto-incremented `u64` shipment id. Ownership, uniqueness and lifecycle are
 * defined in `docs/adr-objectid-chain-shipment-id.md`; this collection is the
 * only place where the two id spaces are tied together.
 */
export interface IShipmentChainId {
  _id: Types.ObjectId;
  /** MongoDB identity of the shipment (24-char hex ObjectId). */
  shipmentId: Types.ObjectId;
  /**
   * Contract `u64` shipment id as a canonical decimal string (no leading zeros).
   * The shape is validated with `U64StringSchema` from `src/shared/types/chain.ts`
   * at the repository boundary and is deliberately not re-declared here, so the
   * encoding cannot drift from the spec.
   */
  chainShipmentId: string;
  /** Deployment the id was allocated on. */
  network: ChainNetwork;
  /** Never set by application code: ids are permanent once allocated (ADR lifecycle rules). */
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const ShipmentChainIdSchema = new Schema(
  {
    shipmentId: { type: Schema.Types.ObjectId, ref: 'Shipment', required: true },
    chainShipmentId: { type: String, required: true },
    network: { type: String, enum: ['testnet', 'public'], required: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

ShipmentChainIdSchema.plugin(isoDatePlugin);

// Uniqueness (P11-10): exactly one u64 per shipment per deployment …
ShipmentChainIdSchema.index({ network: 1, shipmentId: 1 }, { unique: true });

// … and exactly one shipment per u64. This is the collision backstop: a duplicate
// key here means the sequence handed out an id that another row already owns.
ShipmentChainIdSchema.index({ network: 1, chainShipmentId: 1 }, { unique: true });

// Soft delete middleware, kept for the global model conventions. No application
// path sets `deletedAt` — ids must never be recycled or re-pointed at another shipment.
ShipmentChainIdSchema.pre(['find', 'findOne', 'findOneAndUpdate', 'countDocuments'], function () {
  this.where({ deletedAt: null });
});

ShipmentChainIdSchema.pre('aggregate', function () {
  this.pipeline().unshift({ $match: { deletedAt: null } });
});

export const ShipmentChainId = model<IShipmentChainId>('ShipmentChainId', ShipmentChainIdSchema);
