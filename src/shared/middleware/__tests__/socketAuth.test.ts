import { beforeEach, describe, it, expect, jest } from '@jest/globals';
import type { Socket } from 'socket.io';

jest.unstable_mockModule('../../../modules/auth/auth.service.js', () => ({
  verifyToken: jest.fn(),
}));

describe('socketAuth', () => {
  let socketAuth: (_socket: Socket, _next: (_err?: Error) => void) => void;
  let verifyToken: jest.Mock;

  beforeEach(async () => {
    jest.clearAllMocks();
    const authService = await import('../../../modules/auth/auth.service.js');
    verifyToken = authService.verifyToken as jest.Mock;
    const mod = await import('../socketAuth.js');
    socketAuth = mod.socketAuth;
  });

  it('rejects connection when no token provided', () => {
    const socket = { handshake: { auth: {} } } as unknown as Socket;
    const next = jest.fn();

    socketAuth(socket, next);

    expect(next).toHaveBeenCalledWith(new Error('UNAUTHORIZED: Missing token'));
  });

  it('rejects connection when token is invalid', () => {
    verifyToken.mockImplementation(() => {
      throw new Error('invalid');
    });
    const socket = { handshake: { auth: { token: 'bad.token' } } } as unknown as Socket;
    const next = jest.fn();

    socketAuth(socket, next);

    expect(next).toHaveBeenCalledWith(new Error('UNAUTHORIZED: Invalid or expired token'));
  });

  it('attaches user to socket and calls next on valid token', () => {
    const payload = { userId: '123', role: 'user', organizationId: 'org1' };
    verifyToken.mockReturnValue(payload);
    const socket = { handshake: { auth: { token: 'valid.token' } } } as unknown as Socket;
    const next = jest.fn();

    socketAuth(socket, next);

    expect(socket.user).toEqual(payload);
    expect(next).toHaveBeenCalledWith();
  });
});
