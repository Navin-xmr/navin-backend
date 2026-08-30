import { Router } from 'express';
import { asyncHandler } from '../../shared/http/asyncHandler.js';
import { validateRequest } from '../../shared/validation/validate.js';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import { otpLimiter } from '../../shared/middleware/rateLimiter.js';
import {
  getNotificationsController,
  markNotificationReadController,
  markAllNotificationsReadController,
  deleteNotificationController,
  getUnreadCountController,
} from './notifications.controller.js';
import {
  getNotificationPreferencesController,
  updateNotificationPreferenceController,
} from './notification-preferences.controller.js';
import { sendOtpController, verifyOtpController } from './sms-otp.controller.js';
import {
  GetNotificationsQuerySchema,
  NotificationIdParamSchema,
} from './notifications.validation.js';
import { UpdateNotificationPreferenceBodySchema } from './notification-preferences.validation.js';
import { SendOtpBodySchema, VerifyOtpBodySchema } from './sms-otp.validation.js';

export const notificationsRouter = Router();

// All notification routes require authentication
notificationsRouter.use(requireAuth);

notificationsRouter.get(
  '/',
  validateRequest({ query: GetNotificationsQuerySchema }),
  asyncHandler(getNotificationsController)
);

notificationsRouter.get('/unread-count', asyncHandler(getUnreadCountController));

notificationsRouter.patch(
  '/:id/read',
  validateRequest({ params: NotificationIdParamSchema }),
  asyncHandler(markNotificationReadController)
);

notificationsRouter.post('/read-all', asyncHandler(markAllNotificationsReadController));

notificationsRouter.delete(
  '/:id',
  validateRequest({ params: NotificationIdParamSchema }),
  asyncHandler(deleteNotificationController)
);

// Notification preferences
notificationsRouter.get('/preferences', asyncHandler(getNotificationPreferencesController));

notificationsRouter.patch(
  '/preferences',
  validateRequest({ body: UpdateNotificationPreferenceBodySchema }),
  asyncHandler(updateNotificationPreferenceController)
);

// SMS OTP verification (rate-limited)
notificationsRouter.post(
  '/phone/send-otp',
  otpLimiter,
  validateRequest({ body: SendOtpBodySchema }),
  asyncHandler(sendOtpController)
);

notificationsRouter.post(
  '/phone/verify-otp',
  otpLimiter,
  validateRequest({ body: VerifyOtpBodySchema }),
  asyncHandler(verifyOtpController)
);
