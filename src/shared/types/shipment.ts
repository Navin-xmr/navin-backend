import { ShipmentStatus, MilestoneEvent } from '../constants/index.js';

export { ShipmentStatus, MilestoneEvent };

export interface IMilestone {
  name: string;
  timestamp: Date;
  description?: string;
  userId?: string;
  walletAddress?: string;
}

export interface IDeliveryProof {
  url: string;
  recipientSignatureName: string;
  uploadedAt: Date;
}

export type DisputeType =
  'WRONG_GOODS' | 'DAMAGED' | 'NOT_DELIVERED' | 'PAYMENT_DISAGREEMENT' | 'OTHER';
export type DisputeStatus = 'PENDING' | 'ESCROWED' | 'RELEASED' | 'DISPUTED' | 'FAILED';

export type ShipmentDocumentType =
  | 'BILL_OF_LADING'
  | 'CUSTOMS_DECLARATION'
  | 'INSURANCE_CERTIFICATE'
  | 'PACKING_LIST'
  | 'INVOICE'
  | 'OTHER';

export interface IShipmentDocument {
  url: string;
  fileName: string;
  mimeType: string;
  type: ShipmentDocumentType;
  size: number;
  uploadedBy?: string;
  uploadedAt: Date;
}

export interface IShipmentPhoto {
  url: string;
  fileName: string;
  mimeType: string;
  caption?: string;
  size: number;
  uploadedBy?: string;
  uploadedAt: Date;
}

export interface IDispute {
  referenceNumber: string;
  status: DisputeStatus;
  type: DisputeType;
  description: string;
  evidenceUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

/** #997 — create_shipment outbox state, embedded for single-document atomicity. */
export interface ShipmentChainOutbox {
  status: 'pending_chain' | 'processing' | 'anchored' | 'failed';
  idempotencyKey: string;
  attempts: number;
  availableAt: Date;
  lastError?: string;
  txHash?: string;
  ledger?: number;
}

export interface IShipment {
  _id: string;
  trackingNumber: string;
  origin: string;
  destination: string;
  enterpriseId: string;
  logisticsId: string;
  status: ShipmentStatus;
  milestones: IMilestone[];
  offChainMetadata?: Record<string, unknown>;
  stellarTokenId?: string;
  stellarTxHash?: string;
  /** #997 — pending_chain resolves to anchored once the worker submits create_shipment. */
  chainOutbox?: ShipmentChainOutbox;
  /** On-chain `u64` shipment id (decimal string); links indexed contract events to this shipment (#1043). */
  chainShipmentId?: string;
  deliveryProof?: IDeliveryProof;
  documents: IShipmentDocument[];
  photos: IShipmentPhoto[];
  priority?: 'URGENT' | 'STANDARD' | 'ECONOMY';
  expectedDelivery?: Date;
  disputes: IDispute[];
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
