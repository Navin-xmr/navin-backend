import { z } from 'zod';
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MIN_LENGTH_MESSAGE,
  UserRole,
} from '../../shared/constants/index.js';

/**
 * Body schema for `POST /api/company/invitations`.
 * Create a new invitation for a team member.
 */
export const CreateInvitationBodySchema = z.object({
  email: z.string().email('Invalid email address'),
  role: z
    .nativeEnum(UserRole)
    .refine(role => role !== UserRole.SUPER_ADMIN, 'Cannot invite SUPER_ADMIN users'),
  message: z.string().optional(),
});

/**
 * Query schema for `GET /api/company/invitations`.
 * List invitations for the organization with cursor pagination.
 */
export const ListInvitationsQuerySchema = z
  .object({
    limit: z.coerce.number().min(1).max(100).default(20),
    cursor: z.string().optional(),
    status: z.enum(['PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED']).optional(),
  })
  .strict();

/**
 * Params schema for `POST /api/company/invitations/:id/resend`.
 * Resend an invitation.
 */
export const InvitationIdParamSchema = z.object({
  id: z.string().min(1),
});

export type InvitationIdParam = z.infer<typeof InvitationIdParamSchema>;

/**
 * Body schema for `POST /api/company/invitations/accept`.
 * Accept an invitation and create user account.
 *
 * Password policy uses `PASSWORD_MIN_LENGTH` (same constant as users.validation.ts)
 * so the two accept flows enforce identical credentials requirements.
 */
export const AcceptInvitationBodySchema = z.object({
  token: z.string().min(1),
  name: z.string().min(1),
  password: z.string().min(PASSWORD_MIN_LENGTH, PASSWORD_MIN_LENGTH_MESSAGE),
});

/**
 * Query schema for `GET /api/company/invitations/info`.
 * Get invitation info without authentication.
 */
export const InvitationInfoQuerySchema = z.object({
  token: z.string().min(1),
});

export type CreateInvitationBody = z.infer<typeof CreateInvitationBodySchema>;
export type ListInvitationsQuery = z.infer<typeof ListInvitationsQuerySchema>;
export type AcceptInvitationBody = z.infer<typeof AcceptInvitationBodySchema>;
export type InvitationInfoQuery = z.infer<typeof InvitationInfoQuerySchema>;
