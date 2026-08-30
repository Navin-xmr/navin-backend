/**
 * Server-Sent Events (SSE) payload types for GET /api/events.
 * Event names use colon-separated namespaces consumed by the frontend EventSource client.
 */

export type ShipmentStatusEvent = 'PENDING' | 'IN_TRANSIT' | 'DELIVERED' | 'CANCELLED';

export type RealtimeEventType =
  | 'shipment:status'
  | 'shipment:milestone'
  | 'settlement:status'
  | 'notification:new'
  | 'anomaly:detected'
  | 'location:update';

export interface ShipmentStatusRealtimeEvent {
  type: 'shipment:status';
  shipmentId: string;
  newStatus: ShipmentStatusEvent;
  timestamp: string;
}

export interface ShipmentMilestoneRealtimeEvent {
  type: 'shipment:milestone';
  shipmentId: string;
  milestoneId: string;
  event: string;
  txHash?: string;
}

export interface SettlementStatusRealtimeEvent {
  type: 'settlement:status';
  settlementId: string;
  newStatus: string;
  txHash?: string;
}

export interface NotificationRealtimeEvent {
  type: 'notification:new';
  notification: {
    id: string;
    type: string;
    title: string;
    description: string;
    timestamp: string;
    isRead: boolean;
  };
}

export interface AnomalyDetectedRealtimeEvent {
  type: 'anomaly:detected';
  shipmentId: string;
  anomalyType: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface LocationUpdateRealtimeEvent {
  type: 'location:update';
  shipmentId: string;
  lat: number;
  lng: number;
  timestamp: string;
}

export type RealtimeEvent =
  | ShipmentStatusRealtimeEvent
  | ShipmentMilestoneRealtimeEvent
  | SettlementStatusRealtimeEvent
  | NotificationRealtimeEvent
  | AnomalyDetectedRealtimeEvent
  | LocationUpdateRealtimeEvent;

export const REALTIME_EVENT_TYPES: readonly RealtimeEventType[] = [
  'shipment:status',
  'shipment:milestone',
  'settlement:status',
  'notification:new',
  'anomaly:detected',
  'location:update',
] as const;

export const SSE_HEARTBEAT_INTERVAL_MS = 30_000;

export function userSseChannel(userId: string): string {
  return `sse:user:${userId}`;
}
