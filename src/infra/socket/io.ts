import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';

let io: Server | null = null;

export function initSocketIO(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: { origin: '*' },
  });

  io.on('connection', socket => {
    socket.on('join_shipment', (shipmentId: string) => {
      socket.join(`shipment:${shipmentId}`);
    });
  });

  return io;
}

export function getIO(): Server {
  if (!io) throw new Error('Socket.io not initialized');
  return io;
}

export function emitAnomalyDetected(shipmentId: string, anomaly: unknown) {
  getIO().to(`shipment:${shipmentId}`).emit('anomaly_detected', anomaly);
}
