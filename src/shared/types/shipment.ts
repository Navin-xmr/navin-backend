import { ShipmentStatus } from '../constants/index.js';

export { ShipmentStatus };

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
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
