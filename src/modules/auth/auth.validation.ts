import { z } from 'zod';

export const SignupBodySchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(6),
});

export const LoginBodySchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export type SignupInput = z.infer<typeof SignupBodySchema>;
export type LoginInput = z.infer<typeof LoginBodySchema>;
