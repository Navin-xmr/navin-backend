export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          isolatedModules: true,
        },
      },
    ],
  },
  testMatch: ['**/tests/**/*.test.ts', '**/__tests__/**/*.test.ts', '**/src/modules/**/!(*.model)*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/main.ts',
    '!src/loadEnv.ts',
    '!src/scripts/**',
    '!src/workers/**',
    '!src/infra/mongo/connection.ts',
    '!src/infra/redis/connection.ts',
    '!src/infra/socket/io.ts',
  ],
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: {
      statements: 80,
      branches: 80,
      functions: 80,
      lines: 80,
    },
  },
  verbose: true,
  setupFiles: ['./tests/setup.ts'],
  modulePathIgnorePatterns: ['<rootDir>/src/modules/users/__mocks__/'],
};
