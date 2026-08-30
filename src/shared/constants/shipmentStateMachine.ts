import { ShipmentStatus } from '../types/shipment.js';
import { AppError } from '../http/errors.js';

export const ALLOWED_TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> = {
  [ShipmentStatus.CREATED]: [
    ShipmentStatus.PICKUP_CONFIRMED,
    ShipmentStatus.IN_TRANSIT,
    ShipmentStatus.CANCELLED,
  ],
  [ShipmentStatus.PICKUP_CONFIRMED]: [ShipmentStatus.IN_TRANSIT, ShipmentStatus.CANCELLED],
  [ShipmentStatus.IN_TRANSIT]: [
    ShipmentStatus.CUSTOMS_CLEARED,
    ShipmentStatus.OUT_FOR_DELIVERY,
    ShipmentStatus.DELIVERED,
    ShipmentStatus.CANCELLED,
  ],
  [ShipmentStatus.CUSTOMS_CLEARED]: [
    ShipmentStatus.OUT_FOR_DELIVERY,
    ShipmentStatus.DELIVERED,
    ShipmentStatus.CANCELLED,
  ],
  [ShipmentStatus.OUT_FOR_DELIVERY]: [ShipmentStatus.DELIVERED, ShipmentStatus.CANCELLED],
  [ShipmentStatus.DELIVERED]: [ShipmentStatus.SETTLEMENT_INITIATED],
  [ShipmentStatus.SETTLEMENT_INITIATED]: [ShipmentStatus.SETTLEMENT_COMPLETED],
  [ShipmentStatus.SETTLEMENT_COMPLETED]: [],
  [ShipmentStatus.CANCELLED]: [],
};

export function validateStatusTransition(
  currentStatus: ShipmentStatus,
  newStatus: ShipmentStatus
): void {
  const allowedTransitions = ALLOWED_TRANSITIONS[currentStatus] ?? [];
  if (!allowedTransitions.includes(newStatus)) {
    throw new AppError(
      400,
      `Invalid status transition from ${currentStatus} to ${newStatus}`,
      'ERR_SHIPMENT_INVALID_TRANSITION',
      { allowedTransitions }
    );
  }
}
