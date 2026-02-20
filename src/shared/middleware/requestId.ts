import type { Request, RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';

interface RequestWithId extends Request {
  requestId?: string;
}

export function requestId(): RequestHandler {
  return (req, res, next) => {
    const id = req.header('x-request-id') ?? randomUUID();
    res.setHeader('x-request-id', id);
    (req as RequestWithId).requestId = id;
    next();
  };
}
