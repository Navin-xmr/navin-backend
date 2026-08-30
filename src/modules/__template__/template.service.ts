import { AppError, ErrorCodes } from '../../shared/http/errors.js';
import { logger } from '../../shared/logger/logger.js';
import { TemplateModel } from './template.model.js';
import type { CreateTemplateBody } from './template.validation.js';

/**
 * Create a new template.
 */
export async function createTemplateService(input: CreateTemplateBody) {
  const existing = await TemplateModel.findOne({ name: input.name }).lean();
  if (existing) {
    throw new AppError(409, 'Template name already exists', ErrorCodes.DUPLICATE_KEY);
  }

  const template = await TemplateModel.create({
    name: input.name,
    description: input.description,
  });

  logger.info({ templateId: template._id }, 'Template created');

  return {
    id: String(template._id),
    name: template.name,
    description: template.description,
  };
}

/**
 * List templates with offset pagination.
 */
export async function listTemplatesService(params: { page: number; limit: number }) {
  const { page, limit } = params;
  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    TemplateModel.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    TemplateModel.countDocuments(),
  ]);

  return {
    data: data.map(t => ({
      id: String(t._id),
      name: t.name,
      description: t.description,
    })),
    page,
    limit,
    total,
  };
}

/**
 * Get a single template by id.
 */
export async function getTemplateByIdService(id: string) {
  const template = await TemplateModel.findById(id).lean();
  if (!template) {
    throw new AppError(404, 'Template not found', ErrorCodes.NOT_FOUND);
  }

  return {
    id: String(template._id),
    name: template.name,
    description: template.description,
  };
}
