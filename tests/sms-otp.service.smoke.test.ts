/**
 * Smoke test for sms-otp.service (issue #445).
 *
 * Verifies that the OTP service module can be imported and its exported
 * functions can be resolved without a runtime error, even when
 * TWILIO_SID / TWILIO_TOKEN are absent from the environment.
 *
 * The actual send-path (Twilio API call) is exercised only in production,
 * so we only need to confirm the module graph loads cleanly and that the
 * dev-mode path (no Twilio env vars) does not throw.
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

describe('sms-otp.service smoke test', () => {
  beforeEach(() => {
    // Ensure Twilio env vars are absent so the dev/test branch is taken.
    delete process.env.TWILIO_SID;
    delete process.env.TWILIO_TOKEN;
    delete process.env.TWILIO_FROM;
  });

  it('resolves sendOtpService and verifyOtpService as functions', async () => {
    // Mock Redis so no actual connection is required.
    jest.unstable_mockModule('../src/infra/redis/connection.js', () => ({
      getRedisClient: jest.fn(() => ({
        ttl: jest.fn(async () => 0),
        setex: jest.fn(async () => 'OK'),
        get: jest.fn(async () => null),
        del: jest.fn(async () => 1),
      })),
    }));

    const { sendOtpService, verifyOtpService } = await import(
      '../src/modules/notifications/sms-otp.service.js'
    );

    expect(typeof sendOtpService).toBe('function');
    expect(typeof verifyOtpService).toBe('function');
  });

  it('sendOtpService stores OTP in Redis without calling Twilio when env vars are absent', async () => {
    const mockSetex = jest.fn(async () => 'OK');
    const mockTtl = jest.fn(async () => 0);

    jest.unstable_mockModule('../src/infra/redis/connection.js', () => ({
      getRedisClient: jest.fn(() => ({
        ttl: mockTtl,
        setex: mockSetex,
        get: jest.fn(async () => null),
        del: jest.fn(async () => 1),
      })),
    }));

    const { sendOtpService } = await import(
      '../src/modules/notifications/sms-otp.service.js'
    );

    // Should complete without throwing – dev/test path logs the OTP instead of
    // calling Twilio, so no network request is made.
    await expect(sendOtpService('user123', '+10000000000')).resolves.toBeUndefined();

    // Redis setex must have been called to persist the hashed OTP.
    expect(mockSetex).toHaveBeenCalledTimes(1);
    const [key, ttl, value] = mockSetex.mock.calls[0] as [string, number, string];
    expect(key).toMatch(/^otp:user123:/);
    expect(ttl).toBe(300);
    // Value is a SHA-256 hex string (64 chars)
    expect(value).toMatch(/^[0-9a-f]{64}$/);
  });
});