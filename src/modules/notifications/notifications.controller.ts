import type { Request, Response } from 'express';
import { sendResponse } from '../../shared/http/sendResponse.js';
import {
  getNotificationsService,
  markNotificationReadService,
  markAllNotificationsReadService,
  deleteNotificationService,
  getUnreadCountService,
} from './notifications.service.js';
import type { GetNotificationsQuery, NotificationIdParam } from './notifications.validation.js';

export const getNotificationsController = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user?.userId ?? '';
  const query = req.query as unknown as GetNotificationsQuery;

  const result = await getNotificationsService(userId, query);

  sendResponse(res, 200, true, 'Notifications retrieved successfully', result.data, {
    page: result.page,
    limit: result.limit,
    total: result.total,
  });
};

export const markNotificationReadController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params as unknown as NotificationIdParam;
  const userId = req.user?.userId ?? '';

  const notification = await markNotificationReadService(id, userId);

  sendResponse(res, 200, true, 'Notification marked as read', notification);
};

export const markAllNotificationsReadController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const userId = req.user?.userId ?? '';

  const count = await markAllNotificationsReadService(userId);

  sendResponse(res, 200, true, `${count} notifications marked as read`, { count });
};

export const deleteNotificationController = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as unknown as NotificationIdParam;
  const userId = req.user?.userId ?? '';

  const notification = await deleteNotificationService(id, userId);

  sendResponse(res, 200, true, 'Notification deleted successfully', notification);
};

export const getUnreadCountController = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user?.userId ?? '';

  const count = await getUnreadCountService(userId);

  sendResponse(res, 200, true, 'Unread count retrieved successfully', { count });
};
