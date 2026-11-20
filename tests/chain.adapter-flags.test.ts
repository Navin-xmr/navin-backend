/**
 * Chain adapter feature flags tests (#1064).
 *
 * Validates per-environment adapter selection and hard-fail behavior.
 */
import { jest } from '@jest/globals';

// Mock config to test different combinations
let mockConfig = {
  nodeEnv: 'development',
  chainAdapter: 'simulated',
};

// We'll use dependency injection patterns to test flag behavior
describe('Chain Adapter Feature Flags (#1064)', () => {
  describe('validateChainAdapterForEnvironment', () => {
    it('allows simulated in development', () => {
      // Development + simulated should not throw
      const { validateChainAdapterForEnvironment } = require('../src/shared/flags/chain-adapter.flags.js');
      
      jest.spyOn(require('../src/config/index.js'), 'config', 'get').mockReturnValue({
        nodeEnv: 'development',
        chainAdapter: 'simulated',
      });

      expect(() => validateChainAdapterForEnvironment()).not.toThrow();
    });

    it('allows soroban in development', () => {
      // Development + soroban should not throw (warns, but doesn't error)
      const { validateChainAdapterForEnvironment } = require('../src/shared/flags/chain-adapter.flags.js');
      
      jest.spyOn(require('../src/config/index.js'), 'config', 'get').mockReturnValue({
        nodeEnv: 'development',
        chainAdapter: 'soroban',
      });

      expect(() => validateChainAdapterForEnvironment()).not.toThrow();
    });

    it('allows simulated in test', () => {
      // Test + simulated should not throw
      const { validateChainAdapterForEnvironment } = require('../src/shared/flags/chain-adapter.flags.js');
      
      jest.spyOn(require('../src/config/index.js'), 'config', 'get').mockReturnValue({
        nodeEnv: 'test',
        chainAdapter: 'simulated',
      });

      expect(() => validateChainAdapterForEnvironment()).not.toThrow();
    });

    it('allows simulated in staging', () => {
      // Staging + simulated should not throw (warns, but allowed)
      const { validateChainAdapterForEnvironment } = require('../src/shared/flags/chain-adapter.flags.js');
      
      jest.spyOn(require('../src/config/index.js'), 'config', 'get').mockReturnValue({
        nodeEnv: 'staging',
        chainAdapter: 'simulated',
      });

      expect(() => validateChainAdapterForEnvironment()).not.toThrow();
    });

    it('forbids simulated in production', () => {
      // Production + simulated MUST throw
      const { validateChainAdapterForEnvironment } = require('../src/shared/flags/chain-adapter.flags.js');
      
      jest.spyOn(require('../src/config/index.js'), 'config', 'get').mockReturnValue({
        nodeEnv: 'production',
        chainAdapter: 'simulated',
      });

      expect(() => validateChainAdapterForEnvironment()).toThrow(
        /FATAL.*simulated.*production/i
      );
    });

    it('allows soroban in production', () => {
      // Production + soroban should not throw
      const { validateChainAdapterForEnvironment } = require('../src/shared/flags/chain-adapter.flags.js');
      
      jest.spyOn(require('../src/config/index.js'), 'config', 'get').mockReturnValue({
        nodeEnv: 'production',
        chainAdapter: 'soroban',
      });

      expect(() => validateChainAdapterForEnvironment()).not.toThrow();
    });
  });

  describe('shouldEscrowHardFail', () => {
    it('returns true only for production + soroban', () => {
      const { shouldEscrowHardFail } = require('../src/shared/flags/chain-adapter.flags.js');
      
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
        jest.spyOn(require('../src/config/index.js'), 'config', 'get').mockReturnValue({
          nodeEnv: env,
          chainAdapter: adapter,
        });

        const result = shouldEscrowHardFail();
        expect(result).toBe(shouldFail, `Failed for ${env} + ${adapter}`);
      }
    });
  });

  describe('emitEscrowFallbackWarning', () => {
    it('logs fallback warnings with context', () => {
      const { emitEscrowFallbackWarning } = require('../src/shared/flags/chain-adapter.flags.js');
      const mockLogger = {
        warn: jest.fn(),
      };
      
      jest.spyOn(require('../src/shared/logger/logger.js'), 'logger', 'get').mockReturnValue(mockLogger);

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
      // This is more of a documentation test: verifying the expected behavior
      // as described in the issue for all combinations.
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
