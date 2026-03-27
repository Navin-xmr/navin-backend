import { Shipment, ShipmentStatus } from '../shipments/shipments.model.js';
import { IotTelemetry } from './iotTelemetry.model.js';
import type { IotSensorPayload } from './iot.validation.js';

export async function findShipmentBySensorId(sensorId: string): Promise<string | null> {
  const shipment = await Shipment.findOne({
    'offChainMetadata.sensorId': sensorId,
    status: { $in: [ShipmentStatus.CREATED, ShipmentStatus.IN_TRANSIT] },
  })
    .select('_id')
    .lean();

  return shipment ? shipment._id.toString() : null;
}

export async function saveIotTelemetry(payload: IotSensorPayload, shipmentId: string | null) {
  return IotTelemetry.create({
    sensorId: payload.sensorId,
    timestamp: payload.timestamp,
    temp: payload.temp,
    humidity: payload.humidity,
    location: payload.location,
    shipmentId: shipmentId ?? undefined,
  });
}
