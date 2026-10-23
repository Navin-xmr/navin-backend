import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import prettier from 'eslint-plugin-prettier';

export default [
  {
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
    },
  },
  eslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        setImmediate: 'readonly',
        jest: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      prettier,
    },
    rules: {
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
      'no-unused-vars': 'off',
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-console': 'error',
    },
  },
  // P7-22 / #700: seed (and other CLI scripts) use colored console.* for human-readable
  // progress output. Production request paths must use the shared logger instead.
  {
    files: ['src/scripts/**'],
    rules: {
      'no-console': 'off',
    },
  },
  // Unit tests under src/ may spy on console; keep CLI noise out of production paths only.
  {
    files: ['**/__tests__/**'],
    rules: {
      'no-console': 'off',
    },
  },
  // P9-14 / #925: suites must drive the ChainAdapter port instead of reaching into
  // the deprecated stellar.service internals. Keep `tests/stellar.service.test.ts`
  // as the single suite that knowingly tests that module directly.
  {
    files: ['tests/**/*.ts'],
    ignores: ['tests/stellar.service.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/services/stellar.service.js', '**/services/stellar.service'],
              message:
                'Mock the ChainAdapter port (src/services/chain) instead of importing stellar.service directly.',
            },
          ],
        },
      ],
    },
  },
  {
    ignores: ['dist', 'node_modules', 'coverage', 'migrations'],
  },
];
