import { OrganizationModel } from './organizations.model.js';
import type { IOrganization } from '../../shared/types/user.js';

export async function createOrganization(input: {
  name: string;
  type: string;
  settings?: Record<string, unknown>;
}): Promise<IOrganization> {
  return OrganizationModel.create(input);
}

export async function findOrganizationById(id: string): Promise<IOrganization | null> {
  return OrganizationModel.findById(id).lean();
}

export async function findOrganizationByName(name: string): Promise<IOrganization | null> {
  return OrganizationModel.findOne({ name }).lean();
}

export async function listOrganizations(): Promise<IOrganization[]> {
  return OrganizationModel.find().sort({ createdAt: -1 }).lean();
}

export async function updateOrganization(
  id: string,
  updates: Partial<IOrganization>
): Promise<IOrganization | null> {
  return OrganizationModel.findByIdAndUpdate(id, updates, { new: true }).lean();
}

export async function deleteOrganization(id: string): Promise<IOrganization | null> {
  return OrganizationModel.findByIdAndUpdate(id, { deletedAt: new Date() }, { new: true }).lean();
}