import type { Response } from 'express';
import type { Redis } from 'ioredis';

export type SseStreamResponse = Response & {
  writableEnded: boolean;
  write: (chunk: string) => boolean;
  writeHead: (statusCode: number, headers: Record<string, string>) => void;
  on: (event: 'close', listener: () => void) => SseStreamResponse;
  end: () => void;
};

export interface SseClient {
  res: SseStreamResponse;
  heartbeatTimer: ReturnType<typeof setInterval>;
}

export const sseHubState = {
  clientsByUser: new Map<string, Set<SseClient>>(),
  subscriber: null as Redis | null,
  publisher: null as Redis | null,
  redisPubSubReady: false,
};
