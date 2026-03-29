import type { Request, Response } from 'express';
import { getAnomaliesService, resolveAnomalyService } from './anomaly.service.js';

export const getAnomalies = async (req: Request, res: Response) => {
  const { cursor, limit = 20, shipmentId, severity } = req.query;

  const result = await getAnomaliesService({
    cursor: cursor as string | undefined,
    limit: Number(limit),
    shipmentId: shipmentId as string | undefined,
    severity: severity as string | undefined,
  });

  res.json(result);
};

export const resolveAnomaly = async (req: Request, res: Response) => {
  const { id } = req.params;

  const anomaly = await resolveAnomalyService(id);

  res.json({ anomaly });
};
