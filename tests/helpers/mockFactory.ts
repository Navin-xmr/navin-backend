import { jest } from '@jest/globals';

export async function mockModule<T extends Record<string, unknown>>(
  specifier: string,
  overrides: Partial<T>
): Promise<void> {
  await jest.unstable_mockModule(specifier, async () => ({
    ...(jest.requireActual(specifier) as T),
    ...overrides,
  }));
}
