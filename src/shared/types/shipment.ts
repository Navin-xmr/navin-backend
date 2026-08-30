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
