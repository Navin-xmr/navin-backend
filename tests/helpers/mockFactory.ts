import { jest } from '@jest/globals';

// Callers write `specifier` relative to the `tests/` directory (matching the
// convention used for direct `jest.unstable_mockModule` calls in test files),
// but this helper itself lives in `tests/helpers/` — one directory deeper.
// Prepend `../` so both the dynamic import and the mock registration resolve
// to the same file the test file later imports, and so the relative-path
// shape (`../…/*.js`) still matches the `.js` → ts-jest moduleNameMapper rule.
export async function mockModule<T extends Record<string, unknown>>(
  specifier: string,
  overrides: Partial<T>
): Promise<void> {
  const fromHelpers = `../${specifier}`;
  await jest.unstable_mockModule(fromHelpers, () => ({
    ...(jest.requireActual(fromHelpers) as T),
    ...overrides,
  }));
}
