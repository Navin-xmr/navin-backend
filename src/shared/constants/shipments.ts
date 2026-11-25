export enum ShipmentStatus {
  CREATED = 'CREATED',
  PICKUP_CONFIRMED = 'PICKUP_CONFIRMED',
  IN_TRANSIT = 'IN_TRANSIT',
  CUSTOMS_CLEARED = 'CUSTOMS_CLEARED',
  OUT_FOR_DELIVERY = 'OUT_FOR_DELIVERY',
  DELIVERED = 'DELIVERED',
  SETTLEMENT_INITIATED = 'SETTLEMENT_INITIATED',
  SETTLEMENT_COMPLETED = 'SETTLEMENT_COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum MilestoneEvent {
  CREATED = 'CREATED',
  PICKUP_CONFIRMED = 'PICKUP_CONFIRMED',
  IN_TRANSIT = 'IN_TRANSIT',
  CUSTOMS_CLEARED = 'CUSTOMS_CLEARED',
  OUT_FOR_DELIVERY = 'OUT_FOR_DELIVERY',
  DELIVERED = 'DELIVERED',
  SETTLEMENT_INITIATED = 'SETTLEMENT_INITIATED',
  SETTLEMENT_COMPLETED = 'SETTLEMENT_COMPLETED',
  PROOF_SUBMITTED = 'PROOF_SUBMITTED',
  /** #1053 — `dispute_raised`: the chain opened a dispute case. */
  DISPUTED = 'DISPUTED',
  /** #1053 — `dispute_resolved`: the chain closed the dispute with an outcome. */
  RESOLVED = 'RESOLVED',
  /** #1053 — `escrow_frozen`: escrow is blocked until the dispute resolves. */
  ESCROW_FROZEN = 'ESCROW_FROZEN',
  CANCELLED = 'CANCELLED',
  /** #1036 — mirrors the on-chain `dispute_raised` event. */
  DISPUTE_RAISED = 'DISPUTE_RAISED',
  /** #1036 — mirrors the on-chain `dispute_resolved` event. */
  DISPUTE_RESOLVED = 'DISPUTE_RESOLVED',
}
