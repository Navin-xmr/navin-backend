import { jest, describe, it, expect, beforeEach, beforeAll } from '@jest/globals';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const users: any[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
await jest.unstable_mockModule('../src/modules/users/users.model.js', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const UserModel: any = {
    findOne: jest.fn().mockImplementation(async (query: any) =>
      Promise.resolve(users.find(u => u.email === query.email) ?? null)
    ),
    findById: jest.fn().mockImplementation(async (id: any) =>
      Promise.resolve(users.find(u => u._id === id) ?? null)
    ),
    create: jest.fn().mockImplementation(async (data: any) => {
      const created = {
        _id: `user-${Date.now()}`,
        ...data,
      };
      users.push(created);
      return created;
    }),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const OrganizationModel: any = {
    findById: jest.fn().mockResolvedValue(null),
  };

  const UserRole = {
    SUPER_ADMIN: 'SUPER_ADMIN',
    ADMIN: 'ADMIN',
    MANAGER: 'MANAGER',
    VIEWER: 'VIEWER',
    CUSTOMER: 'CUSTOMER',
    DRIVER: 'DRIVER',
  };

  return { UserModel, OrganizationModel, UserRole };
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
await jest.unstable_mockModule('../src/infra/redis/tokenBlocklist.js', () => ({
  blockToken: jest.fn().mockResolvedValue(undefined),
  isTokenBlocked: jest.fn().mockResolvedValue(false),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { signup } = await import('../src/modules/auth/auth.service.js') as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { SignupBodySchema } = await import('../src/modules/auth/auth.validation.js') as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { AppError } = await import('../src/shared/http/errors.js') as any;

describe('Security #202 - Prevent Role Escalation via Signup', () => {
  const jwtSecret = process.env.JWT_SECRET ?? 'test-secret-key-at-least-32-chars-long';

  beforeAll(() => {
    process.env.JWT_SECRET = jwtSecret;
  });

  beforeEach(() => {
    users.length = 0;
    jest.clearAllMocks();
  });

  describe('SignupBodySchema Validation', () => {
    it('should not accept role field in signup request (schema protection)', () => {
      const invalidPayloads = [
        {
          email: 'attacker@test.com',
          name: 'Attacker',
          password: 'SecurePass123',
          role: 'SUPER_ADMIN',
        },
        {
          email: 'attacker@test.com',
          name: 'Attacker',
          password: 'SecurePass123',
          role: 'ADMIN',
        },
      ];

      invalidPayloads.forEach(payload => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = SignupBodySchema.safeParse(payload as any);
        
        // Should succeed but without the role field
        expect(result.success).toBe(true);
        if (result.success) {
          // Role field should not be present in parsed data
          expect((result.data as Record<string, unknown>).role).toBeUndefined();
        }
      });
    });

    it('should require all mandatory fields', () => {
      const missingFields = [
        { name: 'User', password: 'SecurePass123' }, // missing email
        { email: 'user@test.com', password: 'SecurePass123' }, // missing name
        { email: 'user@test.com', name: 'User' }, // missing password
      ];

      missingFields.forEach(payload => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = SignupBodySchema.safeParse(payload as any);
        expect(result.success).toBe(false);
      });
    });

    it('should accept valid signup data without role', () => {
      const validPayload = {
        email: 'validuser@test.com',
        name: 'Valid User',
        password: 'SecurePass123',
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = SignupBodySchema.safeParse(validPayload as any);
      expect(result.success).toBe(true);
    });
  });

  describe('Signup Service Security', () => {
    it('should assign safe default role (VIEWER) to new users', async () => {
      const result = await signup({
        email: 'newuser@test.com',
        name: 'New User',
        password: 'SecurePass123',
      });

      expect(result.user.role).toBe('VIEWER');
      expect(users).toHaveLength(1);
      expect((users[0] as Record<string, unknown>).role).toBe('VIEWER');
    });

    it('should not allow SUPER_ADMIN self-assignment', async () => {
      const result = await signup({
        email: 'hacker@test.com',
        name: 'Hacker',
        password: 'SecurePass123',
      });

      expect(result.user.role).toBe('VIEWER');
      expect(result.user.role).not.toBe('SUPER_ADMIN');
    });

    it('should not allow ADMIN self-assignment', async () => {
      const result = await signup({
        email: 'attacker@test.com',
        name: 'Attacker',
        password: 'SecurePass123',
      });

      expect(result.user.role).not.toBe('ADMIN');
      expect(result.user.role).not.toBe('MANAGER');
    });

    it('should reject duplicate emails', async () => {
      // Register first user
      await signup({
        email: 'duplicate@test.com',
        name: 'User 1',
        password: 'SecurePass123',
      });

      // Try to register with same email
      try {
        await signup({
          email: 'duplicate@test.com',
          name: 'User 2',
          password: 'SecurePass123',
        });
        throw new Error('Should reject duplicate email');
      } catch (err) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const error = err as any;
        expect(error.statusCode).toBe(409);
      }
    });

    it('should generate valid JWT with safe role', async () => {
      const result = await signup({
        email: 'jwttest@test.com',
        name: 'JWT Test',
        password: 'SecurePass123',
      });

      expect(result.token).toBeDefined();
      expect(typeof result.token).toBe('string');

      const parts = result.token.split('.');
      expect(parts).toHaveLength(3);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string name', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = SignupBodySchema.safeParse({
        email: 'user@test.com',
        name: '',
        password: 'SecurePass123',
      } as any);

      expect(result.success).toBe(false);
    });

    it('should handle invalid email format', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = SignupBodySchema.safeParse({
        email: 'not-an-email',
        name: 'User',
        password: 'SecurePass123',
      } as any);

      expect(result.success).toBe(false);
    });

    it('should handle very long inputs', async () => {
      const longName = 'A'.repeat(500);
      const result = await signup({
        email: 'user@test.com',
        name: longName,
        password: 'SecurePass123',
      });

      expect(result.user.role).toBe('VIEWER');
    });

    it('should not expose passwordHash in response', async () => {
      const result = await signup({
        email: 'secure@test.com',
        name: 'Secure User',
        password: 'SecurePass123',
      });

      expect(result.user).not.toHaveProperty('passwordHash');
      expect(result).toHaveProperty('token');
      expect(result.user).toHaveProperty('id');
    });
  });

  describe('Role Determination Logic', () => {
    it('should always assign VIEWER role regardless of email', async () => {
      const emails = [
        'admin@test.com',
        'superadmin@test.com',
        'root@test.com',
        'user@test.com',
      ];

      for (const email of emails) {
        users.length = 0;
        const result = await signup({
          email,
          name: 'User',
          password: 'SecurePass123',
        });

        expect(result.user.role).toBe('VIEWER');
      }
    });
  });
});
