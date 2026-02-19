import type { RequestHandler } from "express";

export const healthController: RequestHandler = (_req, res) => {
  res.status(200).json({ status: "ok" });
};
