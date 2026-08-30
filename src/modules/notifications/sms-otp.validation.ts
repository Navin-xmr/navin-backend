import { z } from 'zod';

export const SendOtpBodySchema = z.object({
  phone: z
    .string()
    .min(10, 'Phone number must be at least 10 digits')
    .max(15, 'Phone number must be at most 15 digits')
    .regex(/^\+?[1-9]\d{9,14}$/, 'Invalid phone number format'),
});

export const VerifyOtpBodySchema = z.object({
  phone: z
    .string()
    .min(10)
    .max(15)
    .regex(/^\+?[1-9]\d{9,14}$/, 'Invalid phone number format'),
  otp: z
    .string()
    .length(6, 'OTP must be 6 digits')
    .regex(/^\d{6}$/, 'OTP must be numeric'),
});

export type SendOtpInput = z.infer<typeof SendOtpBodySchema>;
export type VerifyOtpInput = z.infer<typeof VerifyOtpBodySchema>;
