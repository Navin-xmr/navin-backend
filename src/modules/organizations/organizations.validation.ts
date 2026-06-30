import { z } from 'zod';
import { OrganizationType } from '../../shared/types/user.js';

export const CreateOrganizationBodySchema = z.object({
  name: z.string().min(1, 'Name is required'),
  type: z.nativeEnum(OrganizationType),
  settings: z.record(z.unknown()).optional(),
});

export type CreateOrganizationInput = z.infer<typeof CreateOrganizationBodySchema>;

export const OrganizationIdParamSchema = z.object({
  id: z.string().min(1, 'ID is required'),
});

export type OrganizationIdParam = z.infer<typeof OrganizationIdParamSchema>;

export const UpdateOrganizationBodySchema = z.object({
  name: z.string().min(1).optional(),
  settings: z.record(z.unknown()).optional(),
});

export type UpdateOrganizationInput = z.infer<typeof UpdateOrganizationBodySchema>;