import { Shipment, ShipmentStatus } from './shipments.model.js';
import { Request, Response } from 'express';
import { UserModel } from '../users/users.model.js';
import { tokenizeShipment } from '../../services/stellar.service.js';
import { mockUploadToStorage } from '../../services/mockStorageService.js';

export const getShipments = async (req: Request, res: Response) => {
  const { status, page = 1, limit = 10, ...filters } = req.query;
  const query: any = { ...filters };
  if (status) query.status = status;

  const skip = (Number(page) - 1) * Number(limit);
  const shipments = await Shipment.find(query)
    .skip(skip)
    .limit(Number(limit));
  const total = await Shipment.countDocuments(query);

  res.json({
    data: shipments,
    page: Number(page),
    limit: Number(limit),
    total,
  });
};

export const createShipment = async (req: Request, res: Response) => {
  const { trackingNumber, origin, destination, enterpriseId, logisticsId, status, milestones, offChainMetadata } = req.body;
  const shipment = new Shipment({ trackingNumber, origin, destination, enterpriseId, logisticsId, status, milestones, offChainMetadata });
  await shipment.save();

  try {
    const stellar = await tokenizeShipment({
      trackingNumber,
      origin,
      destination,
      shipmentId: shipment._id.toString(),
    });
    shipment.stellarTokenId = stellar.stellarTokenId;
    shipment.stellarTxHash = stellar.stellarTxHash;
    await shipment.save();
  } catch (err) {
    console.warn('Stellar tokenization skipped:', (err as Error).message);
  }

  res.status(201).json(shipment);
};

export const patchShipment = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { offChainMetadata } = req.body;
  const shipment = await Shipment.findByIdAndUpdate(id, { offChainMetadata }, { new: true });
  if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
  res.json(shipment);
};

export const updateShipmentStatus = async (id: string, status: ShipmentStatus, actor?: { userId?: string; walletAddress?: string }) => {
  const shipment = await Shipment.findById(id);
  if (!shipment) return null;

  if (shipment.status === status) return shipment;

  // Validate status
  if (!Object.values(ShipmentStatus).includes(status)) {
    throw new Error('Invalid status');
  }

  shipment.status = status;

  const milestone: any = {
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

export const patchShipmentStatus = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status || typeof status !== 'string') return res.status(400).json({ message: 'Missing status' });

  if (!Object.values(ShipmentStatus).includes(status as ShipmentStatus)) {
    return res.status(400).json({ message: 'Invalid status value' });
  }

  // resolve actor info from authenticated user if present
  const user = (req as any).user;
  let walletAddress: string | undefined;
  if (user?.userId) {
    const found = await UserModel.findById(user.userId);
    walletAddress = found?.walletAddress || undefined;
  }

  try {
    const updated = await updateShipmentStatus(id, status as ShipmentStatus, { userId: user?.userId, walletAddress });
    if (!updated) return res.status(404).json({ message: 'Shipment not found' });
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ message: err.message || 'Failed to update status' });
  }
};

export const uploadShipmentProof = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { recipientSignatureName } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

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

    if (!shipment) {
      return res.status(404).json({ message: 'Shipment not found' });
    }

    return res.status(200).json({ shipment });
  } catch (error) {
    return res.status(500).json({ message: 'Server error', error });
  }
};
