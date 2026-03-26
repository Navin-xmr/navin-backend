import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';

import { socketAuth } from '../../shared/middleware/socketAuth.js';
import {
  joinShipmentRoom,
  leaveAllShipmentRoomsOnDisconnect,
  leaveShipmentRoom,
  shipmentRoomName,
} from './shipmentRooms.js';

let io: Server | null = null;

export function initSocketIO(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: { origin: '*' },
  });

  io.use(socketAuth);

  io.on('connection', socket => {
    leaveAllShipmentRoomsOnDisconnect(socket);

    socket.on('join_shipment', async (shipmentId: string) => {
      await joinShipmentRoom(socket, shipmentId);
    });

    socket.on('leave_shipment', async (shipmentId: string) => {
      await leaveShipmentRoom(socket, shipmentId);
    });
  });

  return io;
}

export function getIO(): Server {
  if (!io) throw new Error('Socket.io not initialized');
  return io;
}

export function emitAnomalyDetected(shipmentId: string, anomaly: unknown) {
  getIO().to(shipmentRoomName(shipmentId)).emit('anomaly_detected', anomaly);
}
