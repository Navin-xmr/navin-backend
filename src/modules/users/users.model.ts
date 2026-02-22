import mongoose, { type InferSchemaType } from 'mongoose';
import bcrypt from 'bcrypt';


export enum OrganizationType {
  ENTERPRISE = 'ENTERPRISE',
  LOGISTICS = 'LOGISTICS',
}

const OrganizationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    type: { type: String, enum: Object.values(OrganizationType), required: true },
  },
  { timestamps: true }
);

export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  MANAGER = 'MANAGER',
  VIEWER = 'VIEWER',
  CUSTOMER = 'CUSTOMER',
}

const UserSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: Object.values(UserRole), required: true },
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    walletAddress: { type: String, required: false },
  },
  { timestamps: true }
);

// Pre-save hook to hash password
UserSchema.pre('save', async function (next) {
  if (this.isModified('passwordHash')) {
    const salt = await bcrypt.genSalt(10);
    this.passwordHash = await bcrypt.hash(this.passwordHash, salt);
  }
  next();
});

// Override toJSON to hide passwordHash
UserSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.passwordHash;
  return obj;
};


export type Organization = InferSchemaType<typeof OrganizationSchema> & { _id: mongoose.Types.ObjectId };
export const OrganizationModel = mongoose.model<Organization>('Organization', OrganizationSchema);

export type User = InferSchemaType<typeof UserSchema> & { _id: mongoose.Types.ObjectId };
export const UserModel = mongoose.model<User>('User', UserSchema);
