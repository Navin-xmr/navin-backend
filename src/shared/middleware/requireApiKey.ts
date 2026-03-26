import type { RequestHandler } from 'express';
import { AppError } from '../http/errors.js';
import { validateApiKey } from '../../modules/auth/apiKey.service.js';

declare global {
  namespace Express {
    interface Request {
      apiKey?: {
        id: string;
        organizationId: string;
        shipmentId?: string;
      };
    }
  }
}

export const requireApiKey: RequestHandler = async (req, res, next) => {
  const apiKey = req.headers['x-api-key'] as string;

  if (!apiKey) {
    throw new AppError(401, 'Missing x-api-key header', 'UNAUTHORIZED');
  }

  try {
    const { isValid, apiKeyDoc } = await validateApiKey(apiKey);

    if (!isValid || !apiKeyDoc) {
      throw new AppError(401, 'Invalid API key', 'UNAUTHORIZED');
    }

    // Attach API key metadata to request
    req.apiKey = {
      id: apiKeyDoc._id.toString(),
      organizationId: apiKeyDoc.organizationId.toString(),
      shipmentId: apiKeyDoc.shipmentId?.toString(),
    };

    next();
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(401, 'Invalid API key', 'UNAUTHORIZED');
  }
};
