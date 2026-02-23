// Service layer for Shipment
import { Shipment } from './shipments.model.js';

export const findShipments = async (query: any, skip: number, limit: number) => {
  return Shipment.find(query).skip(skip).limit(limit);
};

export const countShipments = async (query: any) => {
  return Shipment.countDocuments(query);
};

export const createShipmentService = async (data: any) => {
  const shipment = new Shipment(data);
  return shipment.save();
};

export const patchShipmentService = async (id: string, offChainMetadata: any) => {
  return Shipment.findByIdAndUpdate(id, { offChainMetadata }, { new: true });
};
