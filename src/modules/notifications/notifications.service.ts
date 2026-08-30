import { AppError, ErrorCodes } from '../../shared/http/errors.js';
import { NotificationModel, type INotification } from './notifications.model.js';
import { offsetSkip } from '../../shared/utils/pagination.js';
import type { GetNotificationsQuery } from './notifications.validation.js';
import type { FilterQuery } from 'mongoose';

export interface NotificationsListResult {
  data: INotification[];
  page: number;
  limit: number;
  total: number;
}

/**
 * Retrieves paginated notifications for a user with optional filtering.
 * @param {string} userId - User ObjectId.
 * @param {GetNotificationsQuery} query - Filter and pagination parameters.
 * @returns {Promise<NotificationsListResult>} Paginated notification list.
 */
export async function getNotificationsService(
  userId: string,
  query: GetNotificationsQuery
): Promise<NotificationsListResult> {
  const { page, limit, type, q } = query;

  const filter: FilterQuery<INotification> = { userId };

  if (type) {
    filter.type = type;
  }

  if (q) {
    filter.$or = [
      { title: { $regex: q, $options: 'i' } },
      { description: { $regex: q, $options: 'i' } },
    ];
  }

  const skip = offsetSkip(page, limit);

  const [data, total] = await Promise.all([
    NotificationModel.find(filter).sort({ timestamp: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    NotificationModel.countDocuments(filter),
  ]);

  return { data, page, limit, total };
}

/**
 * Marks a notification as read.
 * @param {string} notificationId - Notification ObjectId.
 * @param {string} userId - User ObjectId (for authorization).
 * @returns {Promise<INotification>} Updated notification.
 * @throws {AppError} When notification not found or unauthorized.
 */
export async function markNotificationReadService(
  notificationId: string,
  userId: string
): Promise<INotification> {
  const notification = await NotificationModel.findOneAndUpdate(
    { _id: notificationId, userId },
    { isRead: true },
    { new: true }
  ).lean();

  if (!notification) {
    throw new AppError(404, 'Notification not found', ErrorCodes.NOT_FOUND);
  }

  return notification;
}

/**
 * Marks all notifications as read for a user.
 * @param {string} userId - User ObjectId.
 * @returns {Promise<number>} Number of notifications updated.
 */
export async function markAllNotificationsReadService(userId: string): Promise<number> {
  const result = await NotificationModel.updateMany({ userId, isRead: false }, { isRead: true });

  return result.modifiedCount;
}

/**
 * Soft deletes a notification.
 * @param {string} notificationId - Notification ObjectId.
 * @param {string} userId - User ObjectId (for authorization).
 * @returns {Promise<INotification>} Deleted notification.
 * @throws {AppError} When notification not found or unauthorized.
 */
export async function deleteNotificationService(
  notificationId: string,
  userId: string
): Promise<INotification> {
  const notification = await NotificationModel.findOneAndUpdate(
    { _id: notificationId, userId },
    { deletedAt: new Date() },
    { new: true }
  ).lean();

  if (!notification) {
    throw new AppError(404, 'Notification not found', ErrorCodes.NOT_FOUND);
  }

  return notification;
}

/**
 * Gets the count of unread notifications for a user.
 * @param {string} userId - User ObjectId.
 * @returns {Promise<number>} Unread count.
 */
export async function getUnreadCountService(userId: string): Promise<number> {
  return NotificationModel.countDocuments({ userId, isRead: false });
}
