import { AppError, ErrorCodes } from '../../shared/http/errors.js';
import {
  NotificationPreferenceModel,
  type INotificationPreference,
  type NotificationEvent,
  type NotificationChannel,
} from './notification-preferences.model.js';

/**
 * Gets all notification preferences for a user.
 * @param {string} userId - User ObjectId.
 * @returns {Promise<INotificationPreference[]>} Array of notification preferences.
 */
export async function getNotificationPreferencesService(
  userId: string
): Promise<INotificationPreference[]> {
  return NotificationPreferenceModel.find({ userId }).lean();
}

/**
 * Updates or creates a notification preference for a user.
 * @param {string} userId - User ObjectId.
 * @param {object} data - Preference data.
 * @param {NotificationEvent} data.event - Event type.
 * @param {NotificationChannel} data.channel - Channel (email/sms).
 * @param {boolean} data.enabled - Whether the preference is enabled.
 * @returns {Promise<INotificationPreference>} Updated or created preference.
 */
export async function updateNotificationPreferenceService(
  userId: string,
  data: {
    event: NotificationEvent;
    channel: NotificationChannel;
    enabled: boolean;
  }
): Promise<INotificationPreference> {
  const preference = await NotificationPreferenceModel.findOneAndUpdate(
    { userId, event: data.event, channel: data.channel },
    { enabled: data.enabled },
    { new: true, upsert: true }
  ).lean();

  if (!preference) {
    throw new AppError(500, 'Failed to update notification preference', ErrorCodes.INTERNAL_ERROR);
  }

  return preference;
}

const DEFAULT_PREFERENCES: Array<{
  event: NotificationEvent;
  channel: NotificationChannel;
  enabled: boolean;
}> = [
  { event: 'shipment_created', channel: 'email', enabled: true },
  { event: 'status_changed', channel: 'email', enabled: true },
  { event: 'delivery_confirmed', channel: 'email', enabled: true },
  { event: 'payment_received', channel: 'email', enabled: true },
  { event: 'dispute_opened', channel: 'email', enabled: true },
  { event: 'dispute_resolved', channel: 'email', enabled: true },
  { event: 'status_changed', channel: 'sms', enabled: false },
  { event: 'delivery_confirmed', channel: 'sms', enabled: false },
];

/**
 * Seeds default notification preferences for a new user.
 * @param {string} userId - User ObjectId.
 * @returns {Promise<INotificationPreference[]>} Created preferences.
 */
export async function seedDefaultPreferencesService(
  userId: string
): Promise<INotificationPreference[]> {
  const preferences = DEFAULT_PREFERENCES.map(pref => ({
    userId,
    ...pref,
  }));

  return NotificationPreferenceModel.insertMany(preferences, { ordered: false });
}
