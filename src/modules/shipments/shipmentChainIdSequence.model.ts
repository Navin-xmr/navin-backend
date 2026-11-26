import { Schema, model } from 'mongoose';
import { isoDatePlugin } from '../../shared/plugins/isoDatePlugin.js';

/**
 * P11-10 — monotonic per-deployment counter backing on-chain shipment id allocation.
 *
 * `_id` is `shipment_chain_id:<network>`, so both deployments advance independently.
 * Deliberately **not** soft-deletable: the counter is monotonic infrastructure state,
 * not a domain row — deleting or resetting it would re-issue `u64`s the contract has
 * already seen. See `docs/adr-objectid-chain-shipment-id.md`.
 */
export interface IShipmentChainIdSequence {
  _id: string;
  /** Last `u64` handed out for this deployment; `0` before the first allocation. */
  sequence: number;
  createdAt: Date;
  updatedAt: Date;
}

const ShipmentChainIdSequenceSchema = new Schema(
  {
    _id: { type: String, required: true },
    sequence: { type: Number, required: true, default: 0, min: 0 },
  },
  { timestamps: true }
);

// Global model convention: serialise the `timestamps: true` dates as ISO 8601 UTC.
ShipmentChainIdSequenceSchema.plugin(isoDatePlugin);

// Deliberately no `deletedAt` path and no soft-delete pre-hooks: the counter is not a
// domain row, and hiding/resetting it would re-issue ids the contract already knows.

export const ShipmentChainIdSequence = model<IShipmentChainIdSequence>(
  'ShipmentChainIdSequence',
  ShipmentChainIdSequenceSchema
);
