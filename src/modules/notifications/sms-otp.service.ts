import { AppError, ErrorCodes } from '../../shared/http/errors.js';
import { UserModel } from '../users/users.model.js';
import { logger } from '../../shared/logger/logger.js';
import { getRedisClient } from '../../infra/redis/connection.js';
import crypto from 'node:crypto';
import { env } from '../../env.js';

const OTP_TTL_SECONDS = 300; // 5 minutes

function generateOtp(): string {
  return crypto.randomInt(100000, 999999).toString();
}

function hashOtp(otp: string): string {
  return crypto.createHash('sha256').update(otp).digest('hex');
}

function buildOtpRedisKey(userId: string, phone: string): string {
  return `otp:${userId}:${phone}`;
}

/**
 * Sends an OTP to the user's phone via Twilio (or mock in dev).
 * Stores the hashed OTP in Redis with a 5-minute TTL.
 * @param {string} userId - User ObjectId.
 * @param {string} phone - Phone number.
 * @throws {AppError} When SMS sending fails or rate limits exceeded.
 */
export async function sendOtpService(userId: string, phone: string): Promise<void> {
  const redis = getRedisClient();
  const otpKey = buildOtpRedisKey(userId, phone);

  // Check if an OTP was recently sent (rate limiting)
  const existingTtl = await redis.ttl(otpKey);
  if (existingTtl > OTP_TTL_SECONDS - 60) {
    throw new AppError(
      429,
      'OTP already sent. Please wait before requesting a new one.',
      ErrorCodes.RATE_LIMIT_EXCEEDED
    );
  }

  const otp = generateOtp();
  const hashedOtp = hashOtp(otp);

  await redis.setex(otpKey, OTP_TTL_SECONDS, hashedOtp);

  if (env.NODE_ENV === 'production' && env.TWILIO_SID && env.TWILIO_TOKEN && env.TWILIO_FROM) {
    try {
      // In production, use Twilio to send SMS
      // Import dynamically to avoid requiring Twilio in dev
      const twilio = await import('twilio');
      const client = twilio.default(env.TWILIO_SID, env.TWILIO_TOKEN);

      await client.messages.create({
        body: `Your Navin verification code is: ${otp}. Valid for 5 minutes.`,
        from: env.TWILIO_FROM,
        to: phone,
      });

      logger.info({ userId, phone }, 'OTP sent via Twilio');
    } catch (error) {
      logger.error({ error, userId, phone }, 'Failed to send OTP via Twilio');
      throw new AppError(
        503,
        'Failed to send OTP. Please try again later.',
        ErrorCodes.INTERNAL_ERROR
      );
    }
  } else {
    // In dev/test, log the OTP
    logger.info({ userId, phone, otp }, 'OTP generated (dev mode)');
  }
}

/**
 * Verifies an OTP and marks the user's phone as verified.
 * @param {string} userId - User ObjectId.
 * @param {string} phone - Phone number.
 * @param {string} otp - OTP code.
 * @returns {Promise<unknown>} Updated user document.
 * @throws {AppError} When OTP is invalid or expired.
 */
export async function verifyOtpService(
  userId: string,
  phone: string,
  otp: string
): Promise<unknown> {
  const redis = getRedisClient();
  const otpKey = buildOtpRedisKey(userId, phone);

  const storedHash = await redis.get(otpKey);
  if (!storedHash) {
    throw new AppError(400, 'OTP expired or not found', ErrorCodes.BAD_REQUEST);
  }

  const hashedOtp = hashOtp(otp);
  if (hashedOtp !== storedHash) {
    throw new AppError(400, 'Invalid OTP', ErrorCodes.BAD_REQUEST);
  }

  // Mark user as phone verified
  const user = await UserModel.findByIdAndUpdate(
    userId,
    { phoneVerified: true, phone },
    { new: true }
  ).lean();

  if (!user) {
    throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);
  }

  // Delete OTP from Redis
  await redis.del(otpKey);

  logger.info({ userId, phone }, 'Phone verified successfully');

  return user;
}
