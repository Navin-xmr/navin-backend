import { Shipment } from '../shipments/shipments.model.js';
import { ShipmentStatus } from '../shipments/shipments.model.js';
import { AppError, ErrorCodes } from '../../shared/http/errors.js';
import type { PublicTrackingParam } from './publicTracking.validation.js';

export interface PublicTrackingMilestone {
  id: string;
  label: string;
  status: string;
  timestamp: string;
  location?: string;
  isCompleted: boolean;
  isCurrent?: boolean;
}

export interface PublicTrackingResponse {
  trackingNumber: string;
  status: string;
  originCity: string;
  destinationCity: string;
  expectedDelivery: string | null;
  milestones: PublicTrackingMilestone[];
}

/**
 * Retrieves a public tracking view of a shipment by tracking number.
 * Returns only safe, non-sensitive fields suitable for unauthenticated access.
 * @param {PublicTrackingParam} param - The tracking number parameter.
 * @returns {Promise<PublicTrackingResponse>} Public shipment tracking data.
 * @throws {AppError} 404 SHIPMENT_NOT_FOUND when no shipment matches the tracking number.
 */
export const getPublicTrackingService = async (
  param: PublicTrackingParam
): Promise<PublicTrackingResponse> => {
  const { trackingNumber } = param;

  const shipment = await Shipment.findOne({ trackingNumber, deletedAt: null }).lean();

  if (!shipment) {
    throw new AppError(404, 'Shipment not found', ErrorCodes.SHIPMENT_NOT_FOUND);
  }

  // Map internal milestones to public tracking format
  const milestones: PublicTrackingMilestone[] = (shipment.milestones ?? []).map((m, index) => ({
    id: `milestone-${index}`,
    label: m.name,
    status: m.name,
    timestamp: new Date(m.timestamp).toISOString(),
    location: undefined, // Could be enhanced with location from metadata
    isCompleted: true,
    isCurrent:
      index === (shipment.milestones?.length ?? 1) - 1 &&
      shipment.status !== ShipmentStatus.DELIVERED,
  }));

  // Add current status as a milestone if not already present
  const currentStatusLabel = shipment.status;
  const hasCurrentStatusMilestone = milestones.some(m => m.label === currentStatusLabel);
  if (!hasCurrentStatusMilestone) {
    milestones.push({
      id: `milestone-current`,
      label: currentStatusLabel,
      status: currentStatusLabel,
      timestamp: new Date(shipment.updatedAt).toISOString(),
      location: undefined,
      isCompleted: shipment.status === ShipmentStatus.DELIVERED,
      isCurrent: shipment.status !== ShipmentStatus.DELIVERED,
    });
  }

  return {
    trackingNumber: shipment.trackingNumber,
    status: shipment.status,
    originCity: shipment.origin,
    destinationCity: shipment.destination,
    expectedDelivery: shipment.expectedDelivery
      ? new Date(shipment.expectedDelivery).toISOString()
      : null,
    milestones,
  };
};
