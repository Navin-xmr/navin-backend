import mongoose, { type InferSchemaType } from 'mongoose';

const UserSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
  },
  { timestamps: true }
);

export type User = InferSchemaType<typeof UserSchema>;
export const UserModel = mongoose.model('User', UserSchema);
