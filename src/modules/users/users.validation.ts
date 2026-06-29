import { z } from 'zod';
import { UserRole } from '../../shared/constants/index.js';

export const CreateUserBodySchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  role: z.nativeEnum(UserRole).default(UserRole.VIEWER),
});

export const CreateInvitationBodySchema = z.object({
  email: z.string().email(),
  role: z.nativeEnum(UserRole),
});

export const VerifyInvitationQuerySchema = z.object({
  token: z.string().trim().min(1),
});

export const AcceptInvitationBodySchema = z.object({
  token: z.string().trim().min(1),
  name: z.string().trim().min(1),
  password: z.string().min(6),
});

export const ListUsersQuerySchema = z
  .object({
    limit: z.coerce.number().min(1).max(100).default(20),
    cursor: z.string().optional(),
  })
  .strict();

export type ListUsersQuery = z.infer<typeof ListUsersQuerySchema>;
