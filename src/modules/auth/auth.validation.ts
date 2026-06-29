import { z } from 'zod';

export const SignupBodySchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
  organizationId: z.string().min(1).optional(),
});

export const LoginBodySchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export type SignupInput = z.infer<typeof SignupBodySchema>;
export type LoginInput = z.infer<typeof LoginBodySchema>;

export const RefreshBodySchema = z.object({
  token: z.string().min(1),
});

export type RefreshInput = z.infer<typeof RefreshBodySchema>;
