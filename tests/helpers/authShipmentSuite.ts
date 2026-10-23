/**
 * Shared Mongo-backed setup for the auth/shipment integration suites split
 * out of the former `issues-147-150-154-155` bundle (deleted in commit 7e89b83).
 */
import type { Application } from 'express';
import { UserModel, OrganizationModel } from '../../src/modules/users/users.model.js';
import { Shipment } from '../../src/modules/shipments/shipments.model.js';
import { seedOrg, signToken } from '../fixtures/factories.js';

export interface AuthShipmentSuite {
  app: Application;
  testOrgId: string;
  adminToken: string;
  managerToken: string;
  /** Only SUPER_ADMIN may invite ADMIN-role members (invitations.service allowedByRole). */
  superAdminToken: string;
}

export async function seedAuthShipmentSuite(): Promise<AuthShipmentSuite> {
  const { buildApp } = await import('../../src/app.js');
  const app = buildApp();

  // Create test organization
  const org = await seedOrg({ name: 'Test Org Issues' });
  const testOrgId = org._id.toString();

  // Create admin user for testing
  const adminUser = await UserModel.create({
    email: 'admin@navin.io',
    name: 'Admin User',
    passwordHash: 'hashedpassword',
    role: 'ADMIN',
    organizationId: testOrgId,
  });

  // Create manager user for testing
  const managerUser = await UserModel.create({
    email: 'manager@test.com',
    name: 'Manager User',
    passwordHash: 'hashedpassword',
    role: 'MANAGER',
    organizationId: testOrgId,
  });

  // Create super-admin inviter — elevation is invitation-only (#147/#755), and
  // only SUPER_ADMIN is allowed to invite ADMIN-role members.
  const superAdminUser = await UserModel.create({
    email: 'superadmin@navin.io',
    name: 'Super Admin User',
    passwordHash: 'hashedpassword',
    role: 'SUPER_ADMIN',
    organizationId: testOrgId,
  });

  return {
    app,
    testOrgId,
    adminToken: signToken({ userId: adminUser._id.toString(), role: 'ADMIN', organizationId: testOrgId }),
    managerToken: signToken({ userId: managerUser._id.toString(), role: 'MANAGER', organizationId: testOrgId }),
    superAdminToken: signToken({
      userId: superAdminUser._id.toString(),
      role: 'SUPER_ADMIN',
      organizationId: testOrgId,
    }),
  };
}

export async function cleanupAuthShipmentSuite(): Promise<void> {
  await UserModel.deleteMany({ email: { $regex: /test|navin\.io/ } });
  await OrganizationModel.deleteMany({ name: /Test/ });
  await Shipment.deleteMany({ trackingNumber: { $regex: /^NVN-/ } });
}
