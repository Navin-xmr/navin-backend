import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { AppError } from '../../shared/http/errors.js';
import { env } from '../../env.js';
import { UserModel } from '../users/users.model.js';
import type { SignupInput, LoginInput } from './auth.validation.js';

export interface TokenPayload {
  userId: string;
  role: string;
  organizationId?: string;
}

function generateToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '7d' });
}

export async function signup(input: SignupInput) {
  const existing = await UserModel.findOne({ email: input.email });
  if (existing) {
    throw new AppError(409, 'Email already in use', 'EMAIL_TAKEN');
  }

  const hashedPassword = await bcrypt.hash(input.password, 10);

  const user = await UserModel.create({
    email: input.email,
    name: input.name,
    password: hashedPassword,
    role: 'user',
  });

  const token = generateToken({
    userId: user._id.toString(),
    role: user.role,
    organizationId: user.organizationId?.toString(),
  });

  return {
    user: {
      id: user._id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
    token,
  };
}

export async function login(input: LoginInput) {
  const user = await UserModel.findOne({ email: input.email });
  if (!user) {
    throw new AppError(401, 'Invalid credentials', 'INVALID_CREDENTIALS');
  }

  const isValidPassword = await bcrypt.compare(input.password, user.password);
  if (!isValidPassword) {
    throw new AppError(401, 'Invalid credentials', 'INVALID_CREDENTIALS');
  }

  const token = generateToken({
    userId: user._id.toString(),
    role: user.role,
    organizationId: user.organizationId?.toString(),
  });

  return {
    user: {
      id: user._id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
    token,
  };
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, env.JWT_SECRET) as TokenPayload;
}
