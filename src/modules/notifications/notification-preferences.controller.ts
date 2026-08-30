import type { Request, Response } from 'express';
import { sendResponse } from '../../shared/http/sendResponse.js';
import {
  getNotificationPreferencesService,
  updateNotificationPreferenceService,
} from './notification-preferences.service.js';
import type { UpdateNotificationPreferenceInput } from './notification-preferences.validation.js';

export const getNotificationPreferencesController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const userId = req.user?.userId ?? '';

  const preferences = await getNotificationPreferencesService(userId);

  sendResponse(res, 200, true, 'Notification preferences retrieved successfully', preferences);
};

export const updateNotificationPreferenceController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const userId = req.user?.userId ?? '';
  const data = req.body as UpdateNotificationPreferenceInput;

  const preference = await updateNotificationPreferenceService(userId, data);

  sendResponse(res, 200, true, 'Notification preference updated successfully', preference);
};
