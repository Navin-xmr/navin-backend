import { AppError } from '../../shared/http/errors.js';
import { ErrorCodes } from '../../shared/http/errors.js';
import * as organizationsRepo from './organizations.repo.js';
import type { IOrganization } from '../../shared/types/user.js';
import { UserRole } from '../../shared/constants/index.js';

export async function createOrganizationService(input: {
  name: string;
  type: string;
  settings?: Record<string, unknown>;
  callerRole: string;
}): Promise<IOrganization> {
  if (input.callerRole !== UserRole.SUPER_ADMIN) {
    throw new AppError(403, 'Only SUPER_ADMIN can create organizations', ErrorCodes.FORBIDDEN);
  }

  const existing = await organizationsRepo.findOrganizationByName(input.name);
  if (existing) {
    throw new AppError(409, 'Organization already exists', ErrorCodes.DUPLICATE_KEY);
  }

  const org = await organizationsRepo.createOrganization(input);
  return org;
}

export async function listOrganizationsService(callerRole: string): Promise<IOrganization[]> {
  if (callerRole !== UserRole.SUPER_ADMIN) {
    throw new AppError(403, 'Only SUPER_ADMIN can list all organizations', ErrorCodes.FORBIDDEN);
  }

  return organizationsRepo.listOrganizations();
}

export async function getOrganizationService(params: {
  id: string;
  callerRole: string;
  callerOrganizationId?: string;
}): Promise<IOrganization> {
  const { id, callerRole, callerOrganizationId } = params;

  const organization = await organizationsRepo.findOrganizationById(id);
  if (!organization) {
    throw new AppError(404, 'Organization not found', ErrorCodes.ORGANIZATION_NOT_FOUND);
  }

  if (callerRole === UserRole.SUPER_ADMIN) {
    return organization;
  }

  if (callerRole === UserRole.ADMIN) {
    if (!callerOrganizationId || organization._id.toString() !== callerOrganizationId) {
      throw new AppError(403, 'Cannot access organization from another organization', ErrorCodes.FORBIDDEN);
    }
    return organization;
  }

  throw new AppError(403, 'Forbidden: insufficient role', ErrorCodes.FORBIDDEN);
}

export async function updateOrganizationService(params: {
  id: string;
  updates: Partial<IOrganization>;
  callerRole: string;
  callerOrganizationId?: string;
}): Promise<IOrganization> {
  const { id, updates, callerRole, callerOrganizationId } = params;

  const organization = await organizationsRepo.findOrganizationById(id);
  if (!organization) {
    throw new AppError(404, 'Organization not found', ErrorCodes.ORGANIZATION_NOT_FOUND);
  }

  if (callerRole === UserRole.SUPER_ADMIN) {
    const updated = await organizationsRepo.updateOrganization(id, updates);
    if (!updated) throw new AppError(404, 'Organization not found', ErrorCodes.ORGANIZATION_NOT_FOUND);
    return updated;
  }

  if (callerRole === UserRole.ADMIN) {
    if (!callerOrganizationId || organization._id.toString() !== callerOrganizationId) {
      throw new AppError(403, 'Cannot modify organization from another organization', ErrorCodes.FORBIDDEN);
    }
    const { type, ...allowedUpdates } = updates;
    const updated = await organizationsRepo.updateOrganization(id, allowedUpdates);
    if (!updated) throw new AppError(404, 'Organization not found', ErrorCodes.ORGANIZATION_NOT_FOUND);
    return updated;
  }

  throw new AppError(403, 'Forbidden: insufficient role', ErrorCodes.FORBIDDEN);
}

export async function deleteOrganizationService(params: {
  id: string;
  callerRole: string;
}): Promise<IOrganization> {
  const { id, callerRole } = params;

  if (callerRole !== UserRole.SUPER_ADMIN) {
    throw new AppError(403, 'Only SUPER_ADMIN can delete organizations', ErrorCodes.FORBIDDEN);
  }

  const organization = await organizationsRepo.findOrganizationById(id);
  if (!organization) {
    throw new AppError(404, 'Organization not found', ErrorCodes.ORGANIZATION_NOT_FOUND);
  }

  const deleted = await organizationsRepo.deleteOrganization(id);
  if (!deleted) throw new AppError(404, 'Organization not found', ErrorCodes.ORGANIZATION_NOT_FOUND);
  return deleted;
}