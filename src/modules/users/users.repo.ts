import { UserModel } from "./users.model.js";

export async function createUser(input: { email: string; name: string }) {
  return UserModel.create(input);
}

export async function findUserByEmail(email: string) {
  return UserModel.findOne({ email }).lean();
}
