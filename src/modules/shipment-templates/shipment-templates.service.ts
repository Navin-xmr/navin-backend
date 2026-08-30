import { ShipmentTemplate } from './shipment-templates.model.js';
import { AppError, ErrorCodes } from '../../shared/http/errors.js';
import type { IShipmentTemplate } from '../../shared/types/shipmentTemplate.js';
import type { CreateTemplateBody, UpdateTemplateBody } from './shipment-templates.validation.js';

/**
 * Creates a new shipment template scoped to an organization.
 * @param {string} organizationId - The requesting user's organization ID.
 * @param {CreateTemplateInput} data - Validated template creation payload.
 * @returns {Promise<IShipmentTemplate>} The created template.
 * @throws {AppError} On persistence failure.
 */
export const createTemplateService = async (
  organizationId: string,
  data: CreateTemplateBody
): Promise<IShipmentTemplate> => {
  const template = await ShipmentTemplate.create({
    name: data.name,
    fields: data.fields,
    organizationId,
  });
  return template.toObject() as IShipmentTemplate;
};

/**
 * Retrieves all active templates belonging to an organization.
 * @param {string} organizationId - The requesting user's organization ID.
 * @returns {Promise<IShipmentTemplate[]>} List of matching templates.
 */
export const getTemplatesService = async (organizationId: string): Promise<IShipmentTemplate[]> => {
  return ShipmentTemplate.find({ organizationId }).sort({ createdAt: -1 }).lean() as Promise<
    IShipmentTemplate[]
  >;
};

/**
 * Retrieves a single template by ID, scoped to an organization.
 * @param {string} id - Template ObjectId.
 * @param {string} organizationId - The requesting user's organization ID.
 * @returns {Promise<IShipmentTemplate>} The matching template.
 * @throws {AppError} 404 if not found or cross-org access attempted.
 */
export const getTemplateByIdService = async (
  id: string,
  organizationId: string
): Promise<IShipmentTemplate> => {
  const template = await ShipmentTemplate.findOne({ _id: id, organizationId }).lean();
  if (!template) {
    throw new AppError(404, 'Shipment template not found', ErrorCodes.TEMPLATE_NOT_FOUND);
  }
  return template as IShipmentTemplate;
};

/**
 * Partially updates a shipment template.
 * @param {string} id - Template ObjectId.
 * @param {string} organizationId - The requesting user's organization ID.
 * @param {UpdateTemplateInput} data - Validated update payload.
 * @returns {Promise<IShipmentTemplate>} The updated template.
 * @throws {AppError} 404 if not found or cross-org access attempted.
 */
export const updateTemplateService = async (
  id: string,
  organizationId: string,
  data: UpdateTemplateBody
): Promise<IShipmentTemplate> => {
  const updateFields: Record<string, unknown> = {};
  if (data.name !== undefined) updateFields['name'] = data.name;
  if (data.fields !== undefined) updateFields['fields'] = data.fields;

  const updated = await ShipmentTemplate.findOneAndUpdate(
    { _id: id, organizationId },
    { $set: updateFields },
    { new: true, runValidators: true }
  ).lean();

  if (!updated) {
    throw new AppError(404, 'Shipment template not found', ErrorCodes.TEMPLATE_NOT_FOUND);
  }
  return updated as IShipmentTemplate;
};

/**
 * Soft-deletes a shipment template.
 * @param {string} id - Template ObjectId.
 * @param {string} organizationId - The requesting user's organization ID.
 * @returns {Promise<IShipmentTemplate>} The deleted template.
 * @throws {AppError} 404 if not found or cross-org access attempted.
 */
export const deleteTemplateService = async (
  id: string,
  organizationId: string
): Promise<IShipmentTemplate> => {
  const deleted = await ShipmentTemplate.findOneAndUpdate(
    { _id: id, organizationId },
    { $set: { deletedAt: new Date() } },
    { new: true }
  ).lean();

  if (!deleted) {
    throw new AppError(404, 'Shipment template not found', ErrorCodes.TEMPLATE_NOT_FOUND);
  }
  return deleted as IShipmentTemplate;
};
