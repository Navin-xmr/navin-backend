import { z } from 'zod';

const TemplateFieldsSchema = z
  .object({
    origin: z.string().min(1).optional(),
    destination: z.string().min(1).optional(),
    itemDescription: z.string().min(1).optional(),
    weight: z.number().positive().optional(),
    recipientName: z.string().min(1).optional(),
    recipientContact: z.string().min(1).optional(),
  })
  .strict();

export const CreateTemplateBodySchema = z
  .object({
    name: z.string().min(1).max(200),
    fields: TemplateFieldsSchema,
  })
  .strict();

export type CreateTemplateBody = z.infer<typeof CreateTemplateBodySchema>;

export const UpdateTemplateBodySchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    fields: TemplateFieldsSchema.optional(),
  })
  .strict()
  .refine(data => data.name !== undefined || data.fields !== undefined, {
    message: 'At least one field (name or fields) must be provided.',
  });

export type UpdateTemplateBody = z.infer<typeof UpdateTemplateBodySchema>;

export const TemplateIdParamSchema = z.object({
  id: z.string().min(1),
});

export type TemplateIdParam = z.infer<typeof TemplateIdParamSchema>;
