import { z } from 'zod';

/**
 * Body schema for `POST /api/templates`.
 *
 * Business domain: create a new template resource.
 * name is required and trimmed so empty strings are rejected early.
 */
export const CreateTemplateBodySchema = z.object({
  name: z.string().min(1).trim(),
  description: z.string().optional(),
});

export type CreateTemplateBody = z.infer<typeof CreateTemplateBodySchema>;

/**
 * Path-param schema for template-scoped routes (`GET /api/templates/:id`, etc.).
 */
export const TemplateIdParamSchema = z.object({
  id: z.string().min(1),
});

export type TemplateIdParam = z.infer<typeof TemplateIdParamSchema>;

/**
 * Query schema for `GET /api/templates`.
 *
 * Business domain: list templates with offset pagination.
 */
export const ListTemplatesQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

export type ListTemplatesQuery = z.infer<typeof ListTemplatesQuerySchema>;
