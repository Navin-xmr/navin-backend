import type { RequestHandler } from "express";
import { randomUUID } from "node:crypto";

export function requestId(): RequestHandler {
  return (req, res, next) => {
    const id = req.header("x-request-id") ?? randomUUID();
    res.setHeader("x-request-id", id);
    (req as any).requestId = id;
    next();
  };
}
