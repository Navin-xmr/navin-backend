import type { Socket } from 'socket.io';
import { verifyToken, type TokenPayload } from '../../modules/auth/auth.service.js';

declare module 'socket.io' {
  interface Socket {
    user?: TokenPayload;
  }
}

export function socketAuth(socket: Socket, next: (err?: Error) => void): void {
  const token = socket.handshake.auth?.token as string | undefined;

  if (!token) {
    return next(new Error('UNAUTHORIZED: Missing token'));
  }

  try {
    const payload = verifyToken(token);
    socket.user = payload;
    next();
  } catch {
    next(new Error('UNAUTHORIZED: Invalid or expired token'));
  }
}
