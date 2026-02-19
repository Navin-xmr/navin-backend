import { AppError } from "../../shared/http/errors.js";
import { createUser, findUserByEmail } from "./users.repo.js";

export async function registerUser(input: { email: string; name: string }) {
  const existing = await findUserByEmail(input.email);
  if (existing) throw new AppError(409, "Email already in use", "EMAIL_TAKEN");
  return createUser(input);
}
