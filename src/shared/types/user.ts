import { OrganizationType, UserRole } from '../constants/index.js';

export { OrganizationType, UserRole };

export interface IOrganization {
  _id: string;
  name: string;
  type: OrganizationType;
  settings?: Record<string, unknown>;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IUser {
  _id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: UserRole;
  organizationId: string;
  walletAddress?: string;
  phone?: string;
  phoneVerified?: boolean;
  twoFactorSecret?: string;
  twoFactorEnabled?: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  // TOTP 2FA fields
  totpSecret?: string | null;
  totpEnabled: boolean;
  totpBackupCodes: string[];
}
