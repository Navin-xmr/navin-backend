import { afterEach, describe, expect, it, jest } from '@jest/globals';

const originalEnv = { ...process.env };

describe('Soroban resource fee policy', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it('accepts usage within fee, CPU, and ledger-byte ceilings', async () => {
    process.env.SOROBAN_MAX_RESOURCE_FEE_TESTNET = '1000';
    process.env.SOROBAN_MAX_CPU_INSTRUCTIONS = '500';
    process.env.SOROBAN_MAX_LEDGER_BYTES = '300';
    jest.resetModules();

    const { enforceSorobanResourceBudget } = await import('../src/services/chain/fee-policy.js');
    expect(() =>
      enforceSorobanResourceBudget(
        { resourceFee: '1000', cpuInstructions: 500, ledgerBytes: 300 },
        'testnet'
      )
    ).not.toThrow();
  });

  it('rejects over-budget usage with a typed retryable error and increments the metric', async () => {
    process.env.SOROBAN_MAX_RESOURCE_FEE_TESTNET = '1000';
    process.env.SOROBAN_MAX_CPU_INSTRUCTIONS = '500';
    process.env.SOROBAN_MAX_LEDGER_BYTES = '300';
    jest.resetModules();

    const { enforceSorobanResourceBudget, getSorobanBudgetRejectionCount } =
      await import('../src/services/chain/fee-policy.js');

    expect(() =>
      enforceSorobanResourceBudget(
        { resourceFee: '1001', cpuInstructions: 501, ledgerBytes: 301 },
        'testnet'
      )
    ).toThrow(
      expect.objectContaining({
        statusCode: 503,
        code: 'ERR_CHAIN_FEE_BUDGET_EXCEEDED',
      })
    );
    expect(getSorobanBudgetRejectionCount()).toBe(1);
  });
});
