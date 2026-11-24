/**
 * Chain adapter feature flags tests (#1064).
 *
 * Validates per-environment adapter selection and hard-fail behavior.
 */
import { jest } from '@jest/globals';

const mockConfig: { nodeEnv: string; chainAdapter: string } = {
  nodeEnv: 'development',
  chainAdapter: 'simulated',
};

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

jest.unstable_mockModule('../src/config/index.js', () => ({
  config: mockConfig,
}));

jest.unstable_mockModule('../src/shared/logger/logger.js', () => ({
  logger: mockLogger,
}));

const { validateChainAdapterForEnvironment, shouldEscrowHardFail, emitEscrowFallbackWarning } =
  await import('../src/shared/flags/chain-adapter.flags.js');

describe('Chain Adapter Feature Flags (#1064)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig.nodeEnv = 'development';
    mockConfig.chainAdapter = 'simulated';
  });

  describe('validateChainAdapterForEnvironment', () => {
    it('allows simulated in development', () => {
      mockConfig.nodeEnv = 'development';
      mockConfig.chainAdapter = 'simulated';

      expect(() => validateChainAdapterForEnvironment()).not.toThrow();
    });

    it('allows soroban in development', () => {
      mockConfig.nodeEnv = 'development';
      mockConfig.chainAdapter = 'soroban';

      expect(() => validateChainAdapterForEnvironment()).not.toThrow();
    });

    it('allows simulated in test', () => {
      mockConfig.nodeEnv = 'test';
      mockConfig.chainAdapter = 'simulated';

      expect(() => validateChainAdapterForEnvironment()).not.toThrow();
    });

    it('allows simulated in staging', () => {
      mockConfig.nodeEnv = 'staging';
      mockConfig.chainAdapter = 'simulated';

      expect(() => validateChainAdapterForEnvironment()).not.toThrow();
    });

    it('forbids simulated in production', () => {
      mockConfig.nodeEnv = 'production';
      mockConfig.chainAdapter = 'simulated';

      expect(() => validateChainAdapterForEnvironment()).toThrow(/FATAL.*simulated.*production/i);
    });

    it('allows soroban in production', () => {
      mockConfig.nodeEnv = 'production';
      mockConfig.chainAdapter = 'soroban';

      expect(() => validateChainAdapterForEnvironment()).not.toThrow();
    });
  });

  describe('shouldEscrowHardFail', () => {
    it('returns true only for production + soroban', () => {
      const cases = [
        { env: 'development', adapter: 'simulated', shouldFail: false },
        { env: 'development', adapter: 'soroban', shouldFail: false },
        { env: 'test', adapter: 'simulated', shouldFail: false },
        { env: 'test', adapter: 'soroban', shouldFail: false },
        { env: 'staging', adapter: 'simulated', shouldFail: false },
        { env: 'staging', adapter: 'soroban', shouldFail: false },
        { env: 'production', adapter: 'simulated', shouldFail: false }, // Prevented earlier
        { env: 'production', adapter: 'soroban', shouldFail: true },
      ];

      for (const { env, adapter, shouldFail } of cases) {
        mockConfig.nodeEnv = env;
        mockConfig.chainAdapter = adapter;

        const result = shouldEscrowHardFail();
        expect(result).toBe(shouldFail);
      }
    });
  });

  describe('emitEscrowFallbackWarning', () => {
    it('logs fallback warnings with context', () => {
      emitEscrowFallbackWarning('releaseEscrow', 'payment-123');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          context: 'releaseEscrow',
          id: 'payment-123',
        }),
        expect.stringContaining('ESCROW FALLBACK')
      );
    });
  });

  describe('Flag Matrix (Issue Description)', () => {
    it('documents the complete flag matrix', () => {
      const matrix = [
        { env: 'development', adapter: 'simulated', allowed: true, recommended: true },
        { env: 'development', adapter: 'soroban', allowed: true, recommended: false },
        { env: 'test', adapter: 'simulated', allowed: true, recommended: true },
        { env: 'test', adapter: 'soroban', allowed: true, recommended: false },
        { env: 'staging', adapter: 'simulated', allowed: true, recommended: false },
        { env: 'staging', adapter: 'soroban', allowed: true, recommended: true },
        { env: 'production', adapter: 'simulated', allowed: false, recommended: false },
        { env: 'production', adapter: 'soroban', allowed: true, recommended: true },
      ];

      expect(matrix).toHaveLength(8);

      // Production forbids simulated
      const prodSimulated = matrix.find(m => m.env === 'production' && m.adapter === 'simulated');
      expect(prodSimulated?.allowed).toBe(false);

      // Production requires soroban
      const prodSoroban = matrix.find(m => m.env === 'production' && m.adapter === 'soroban');
      expect(prodSoroban?.allowed).toBe(true);
      expect(prodSoroban?.recommended).toBe(true);
    });
  });
});
