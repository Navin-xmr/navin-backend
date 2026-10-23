import { z } from 'zod';
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MIN_LENGTH_MESSAGE,
  UserRole,
} from '../../shared/constants/index.js';

/**
 * Body schema for `POST /api/users` and `POST /api/users/team`.
 *
 * Business domain: admin provisioning of org users. Role defaults to VIEWER so
 * least privilege applies unless an admin explicitly elevates the account.
 */
export const CreateUserBodySchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  role: z.nativeEnum(UserRole).default(UserRole.VIEWER),
});

/**
 * Body schema for `POST /api/users/invitations`.
 *
 * Business domain: invite a teammate by email with an intended role before they
 * set a password. Role is required (no default) so invitations never silently
 * create elevated accounts without an explicit admin choice.
 */
export const CreateInvitationBodySchema = z.object({
  email: z.string().email(),
  role: z.nativeEnum(UserRole),
});

/**
 * Query schema for `GET /api/users/invitations/verify`.
 *
 * Business domain: validate an invitation token from the email link before the
 * accept UI collects name/password — avoids starting accept with a dead token.
 */
export const VerifyInvitationQuerySchema = z.object({
  token: z.string().trim().min(1),
});

/**
 * Body schema for `POST /api/users/invitations/accept`.
 *
 * Business domain: convert a pending invitation into a real user with credentials.
 * Password policy matches signup so invited users cannot bypass length requirements.
 */
export const AcceptInvitationBodySchema = z.object({
  token: z.string().trim().min(1),
  name: z.string().trim().min(1),
  password: z.string().min(PASSWORD_MIN_LENGTH, PASSWORD_MIN_LENGTH_MESSAGE),
});

/**
 * Query schema for `GET /api/users`.
 *
 * Business domain: admin/manager user directory listing.
 *
 * Supports two pagination modes (see docs/PAGINATION.md):
 *   - Cursor mode (`cursor`, `limit`) → `meta: { nextCursor, hasMore }`
 *   - Offset mode (`page`, `limit`)   → `meta: { page, limit, total }`
 *
 * Sending both `cursor` and `page` is a 400 validation error.
 * Additional filters: `search` (case-insensitive name/email), `role` (enum).
 * Unknown query params are silently stripped (no `.strict()`) so future params
 * added by the frontend do not cause spurious 400 responses.
 */
export const ListUsersQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().trim().optional(),
    page: z.coerce.number().int().min(1).optional(),
    search: z.string().trim().optional(),
    role: z.nativeEnum(UserRole).optional(),
  })
  .strict()
  .refine(data => !(data.cursor && data.page !== undefined), {
    message: 'Use either cursor or page for pagination, not both.',
  });

/**
 * Body schema for `PATCH /api/users/me`.
 *
 * Business domain: self-service profile update. All fields optional so the
 * frontend can send only what changed. `companyName` is special — it updates
 * the linked Organization's name and is restricted to ADMIN / SUPER_ADMIN by
 * the service layer (not here, so the schema stays role-agnostic).
 */
export const UpdateCurrentUserBodySchema = z.object({
  fullName: z.string().trim().min(1).optional(),
  email: z.string().email().optional(),
  companyName: z.string().trim().min(1).optional(),
});

export type CreateUserBody = z.infer<typeof CreateUserBodySchema>;
export type CreateInvitationBody = z.infer<typeof CreateInvitationBodySchema>;
export type VerifyInvitationQuery = z.infer<typeof VerifyInvitationQuerySchema>;
export type AcceptInvitationBody = z.infer<typeof AcceptInvitationBodySchema>;
export type ListUsersQuery = z.infer<typeof ListUsersQuerySchema>;
export type UpdateCurrentUserBody = z.infer<typeof UpdateCurrentUserBodySchema>;
