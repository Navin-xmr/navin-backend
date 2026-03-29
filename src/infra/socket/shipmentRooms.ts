import type { Socket } from 'socket.io';
import { Shipment } from '../../modules/shipments/shipments.model.js';

export function shipmentRoomName(shipmentId: string) {
  return `shipment_${shipmentId}`;
}

export async function isAuthorizedForShipment(params: {
  shipmentId: string;
  organizationId?: string;
}) {
  const { shipmentId, organizationId } = params;
  if (!shipmentId || !organizationId) return false;

  const shipment = await Shipment.findById(shipmentId)
    .select({ enterpriseId: 1, logisticsId: 1 })
    .lean<{
      enterpriseId?: { toString: () => string } | string;
      logisticsId?: { toString: () => string } | string;
    }>();
  if (!shipment) return false;

  const enterpriseId = shipment.enterpriseId?.toString();
  const logisticsId = shipment.logisticsId?.toString();
  return enterpriseId === organizationId || logisticsId === organizationId;
}

export async function joinShipmentRoom(socket: Socket, shipmentId: string) {
  const organizationId = socket.user?.organizationId;
  const ok = await isAuthorizedForShipment({ shipmentId, organizationId });

  if (!ok) {
    socket.emit('error', { code: 'UNAUTHORIZED', message: 'Not allowed to view this shipment' });
    return;
  }

  const room = shipmentRoomName(shipmentId);
  await socket.join(room);
  socket.emit('room_joined', { shipmentId, room });
}

export async function leaveShipmentRoom(socket: Socket, shipmentId: string) {
  const room = shipmentRoomName(shipmentId);
  await socket.leave(room);
  socket.emit('room_left', { shipmentId, room });
}

export function leaveAllShipmentRoomsOnDisconnect(socket: Socket) {
  socket.on('disconnecting', () => {
    for (const room of socket.rooms) {
      if (room.startsWith('shipment_')) socket.leave(room);
    }
  });
}
