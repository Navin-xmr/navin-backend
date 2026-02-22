import { Shipment, ShipmentStatus } from './shipments.model';
import { Request, Response } from 'express';

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
  res.status(201).json(shipment);
};

export const patchShipment = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { offChainMetadata } = req.body;
  const shipment = await Shipment.findByIdAndUpdate(id, { offChainMetadata }, { new: true });
  if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
  res.json(shipment);
};
