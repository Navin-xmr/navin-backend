import { Shipment, ShipmentStatus } from './shipments.model.js';
import type { FilterQuery } from 'mongoose';
import { tokenizeShipment } from '../../services/stellar.service.js';
import { mockUploadToStorage } from '../../services/mockStorageService.js';

export const findShipments = async (query: FilterQuery<unknown>, skip: number, limit: number) => {
  return Shipment.find(query).skip(skip).limit(limit);
};

export const countShipments = async (query: FilterQuery<unknown>) => {
  return Shipment.countDocuments(query);
};

export const createShipmentService = async (data: { trackingNumber: string; origin: string; destination: string; [key: string]: unknown }) => {
  const shipment = new Shipment(data);
  await shipment.save();

  try {
    const stellar = await tokenizeShipment({
      trackingNumber: shipment.trackingNumber,
      origin: shipment.origin,
      destination: shipment.destination,
      shipmentId: shipment._id.toString(),
    });
    shipment.stellarTokenId = stellar.stellarTokenId;
    shipment.stellarTxHash = stellar.stellarTxHash;
    await shipment.save();
  } catch (err) {
    console.warn('Stellar tokenization skipped:', (err as Error).message);
  }

  return shipment;
};

export const patchShipmentService = async (id: string, offChainMetadata: unknown) => {
  return Shipment.findByIdAndUpdate(id, { offChainMetadata }, { new: true });
};

export const updateShipmentStatusService = async (id: string, status: ShipmentStatus, actor?: { userId?: string; walletAddress?: string }) => {
  const shipment = await Shipment.findById(id);
  if (!shipment) return null;

  if (shipment.status === status) return shipment;

  if (!Object.values(ShipmentStatus).includes(status)) {
    throw new Error('Invalid status');
  }

  shipment.status = status;

  const milestone: Record<string, unknown> = {
    name: status,
    timestamp: new Date(),
    description: `Status changed to ${status}`,
  };

  if (actor?.userId) {
    milestone.userId = actor.userId;
  }
  if (actor?.walletAddress) {
    milestone.walletAddress = actor.walletAddress;
  }

  shipment.milestones.push(milestone);

  await shipment.save();
  return shipment;
};

export const uploadShipmentProofService = async (id: string, file: Express.Multer.File, recipientSignatureName: string) => {
  const fakeUrl = await mockUploadToStorage(file);
  const shipment = await Shipment.findByIdAndUpdate(
    id,
    {
      deliveryProof: {
        url: fakeUrl,
        recipientSignatureName,
        uploadedAt: new Date(),
      },
    },
    { new: true },
  );
  return shipment;
};
