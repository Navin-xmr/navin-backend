import { Types } from 'mongoose';
import { Shipment } from '../../modules/shipments/shipments.model.js';
import { UserModel } from '../../modules/users/users.model.js';
import { publishToUser } from './sseHub.js';
import { logger } from '../../shared/logger/logger.js';
import type {
  AnomalyDetectedRealtimeEvent,
  LocationUpdateRealtimeEvent,
  NotificationRealtimeEvent,
  RealtimeEvent,
  SettlementStatusRealtimeEvent,
  ShipmentMilestoneRealtimeEvent,
  ShipmentStatusEvent,
  ShipmentStatusRealtimeEvent,
} from '../../shared/types/realtimeEvents.js';
import type {
  AnomalyAlertPayload,
  PaymentStatusPayload,
  StatusUpdatePayload,
  TelemetryUpdatePayload,
} from '../../shared/types/socketEvents.js';

async function getUserIdsForShipment(shipmentId: string): Promise<string[]> {
  const shipment = await Shipment.findById(shipmentId)
    .select({ enterpriseId: 1, logisticsId: 1 })
    .lean<{
      enterpriseId?: { toString: () => string } | string;
      logisticsId?: { toString: () => string } | string;
    }>();

  if (!shipment) {
    return [];
  }

  const orgIds = [shipment.enterpriseId, shipment.logisticsId]
    .filter((id): id is { toString: () => string } | string => Boolean(id))
    .map(id => id.toString());

  if (orgIds.length === 0) {
    return [];
  }

  const users = await UserModel.find({
    organizationId: { $in: orgIds.map(id => new Types.ObjectId(id)) },
  })
    .select({ _id: 1 })
    .lean<{ _id: { toString: () => string } }[]>();

  return [...new Set(users.map(user => user._id.toString()))];
}

async function fanoutToShipmentUsers(
  shipmentId: string,
  buildEvent: () => RealtimeEvent | RealtimeEvent[]
): Promise<void> {
  const userIds = await getUserIdsForShipment(shipmentId);
  if (userIds.length === 0) {
    return;
  }

  const events = buildEvent();
  const eventList = Array.isArray(events) ? events : [events];

  for (const userId of userIds) {
    for (const event of eventList) {
      publishToUser(userId, event);
    }
  }
}

function mapShipmentStatus(status: StatusUpdatePayload['status']): ShipmentStatusEvent {
  if (status === 'CREATED') {
    return 'PENDING';
  }
  if (status === 'IN_TRANSIT') return 'IN_TRANSIT';
  if (status === 'DELIVERED' || status === 'SETTLEMENT_COMPLETED') return 'DELIVERED';
  if (status === 'CANCELLED') return 'CANCELLED';
  return 'IN_TRANSIT';
}

/**
 * Fans out shipment status and milestone SSE events to org members.
 */
export async function fanoutStatusUpdate(
  shipmentId: string,
  statusData: StatusUpdatePayload
): Promise<void> {
  await fanoutToShipmentUsers(shipmentId, () => {
    const events: RealtimeEvent[] = [
      {
        type: 'shipment:status',
        shipmentId,
        newStatus: mapShipmentStatus(statusData.status),
        timestamp:
          statusData.updatedAt instanceof Date
            ? statusData.updatedAt.toISOString()
            : typeof statusData.updatedAt === 'string'
              ? statusData.updatedAt
              : new Date().toISOString(),
      } satisfies ShipmentStatusRealtimeEvent,
    ];

    const milestones = statusData.milestones ?? [];
    const latestMilestone = milestones.at(-1);
    if (latestMilestone) {
      events.push({
        type: 'shipment:milestone',
        shipmentId,
        milestoneId: `${shipmentId}-${latestMilestone.name}-${String(latestMilestone.timestamp)}`,
        event: latestMilestone.name,
        txHash: latestMilestone.walletAddress ?? undefined,
      } satisfies ShipmentMilestoneRealtimeEvent);
    }

    return events;
  });
}

/**
 * Fans out anomaly detection SSE events to org members.
 */
export async function fanoutAnomalyDetected(
  shipmentId: string,
  anomaly: AnomalyAlertPayload
): Promise<void> {
  await fanoutToShipmentUsers(
    shipmentId,
    () =>
      ({
        type: 'anomaly:detected',
        shipmentId,
        anomalyType: anomaly.type,
        severity: anomaly.severity,
      }) satisfies AnomalyDetectedRealtimeEvent
  );
}

/**
 * Fans out location update SSE events to org members.
 */
export async function fanoutLocationUpdate(
  shipmentId: string,
  telemetry: TelemetryUpdatePayload
): Promise<void> {
  await fanoutToShipmentUsers(
    shipmentId,
    () =>
      ({
        type: 'location:update',
        shipmentId,
        lat: telemetry.latitude,
        lng: telemetry.longitude,
        timestamp: telemetry.timestamp,
      }) satisfies LocationUpdateRealtimeEvent
  );
}

/**
 * Fans out settlement status SSE events to org members.
 */
export async function fanoutSettlementStatus(
  shipmentId: string,
  payment: PaymentStatusPayload & { stellarTxHash?: string }
): Promise<void> {
  await fanoutToShipmentUsers(
    shipmentId,
    () =>
      ({
        type: 'settlement:status',
        settlementId: payment.paymentId,
        newStatus: payment.newStatus,
        txHash: payment.stellarTxHash,
      }) satisfies SettlementStatusRealtimeEvent
  );
}

/**
 * Publishes a notification SSE event to a specific user.
 */
export function fanoutNotificationToUser(
  userId: string,
  notification: NotificationRealtimeEvent['notification']
): void {
  publishToUser(userId, {
    type: 'notification:new',
    notification,
  } satisfies NotificationRealtimeEvent);
}

export async function safeFanout(
  label: string,
  shipmentId: string,
  fn: () => Promise<void>
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    logger.error({ err, label, shipmentId }, 'SSE fan-out failed');
  }
}
