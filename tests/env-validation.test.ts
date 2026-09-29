/**
 * env-validation.test.ts
 *
 * Unit tests for the environment schema defined in src/env.schema.ts.
 * Tests cover all three SOROBAN_ADAPTER states:
 *   1. Adapter omitted / set to "simulated" (default) — no Soroban credentials required.
 *   2. Adapter = "simulated" with Soroban credentials supplied — still valid.
 *   3. Adapter = "soroban" without credentials — boot must fail with clear messages.
 *   4. Adapter = "soroban" with both credentials — valid.
 *
 * Importing env.schema.ts (not env.ts) keeps tests free of the process.exit(1)
 * side-effect that fires when process.env is invalid at module load time.
 */
import { describe, expect, it } from '@jest/globals';

import { envSchema } from '../src/env.schema.js';

/** Minimal valid env that satisfies all required fields. */
const BASE_ENV = {
  MONGO_URI: 'mongodb://127.0.0.1:27017/test',
  JWT_SECRET: 'test-jwt-secret-key-at-least-32-chars-long!',
};

describe('env schema — SOROBAN_ADAPTER validation', () => {
  // -------------------------------------------------------------------------
  // State 1: adapter omitted → defaults to "simulated"; credentials not required
  // -------------------------------------------------------------------------
  describe('state 1: SOROBAN_ADAPTER omitted (defaults to simulated)', () => {
    it('accepts a minimal valid env with no Soroban fields', () => {
      const result = envSchema.safeParse(BASE_ENV);
      expect(result.success).toBe(true);
    });

    it('defaults SOROBAN_ADAPTER to "simulated"', () => {
      const result = envSchema.safeParse(BASE_ENV);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.SOROBAN_ADAPTER).toBe('simulated');
      }
    });

    it('does not require SOROBAN_RPC_URL when adapter is omitted', () => {
      const result = envSchema.safeParse({ ...BASE_ENV, ESCROW_CONTRACT_ID: 'CABC123' });
      expect(result.success).toBe(true);
    });

    it('does not require ESCROW_CONTRACT_ID when adapter is omitted', () => {
      const result = envSchema.safeParse({
        ...BASE_ENV,
        SOROBAN_RPC_URL: 'https://soroban-rpc.example.com',
      });
      expect(result.success).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // State 2: adapter = "simulated" with credentials supplied — still valid
  // -------------------------------------------------------------------------
  describe('state 2: SOROBAN_ADAPTER=simulated with credentials supplied', () => {
    it('accepts Soroban credentials when adapter is simulated (credentials are optional)', () => {
      const result = envSchema.safeParse({
        ...BASE_ENV,
        SOROBAN_ADAPTER: 'simulated',
        SOROBAN_RPC_URL: 'https://soroban-rpc.example.com',
        ESCROW_CONTRACT_ID: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2B',
      });
      expect(result.success).toBe(true);
    });

    it('preserves supplied Soroban values in parsed output', () => {
      const rpcUrl = 'https://soroban-rpc.example.com';
      const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2B';
      const result = envSchema.safeParse({
        ...BASE_ENV,
        SOROBAN_ADAPTER: 'simulated',
        SOROBAN_RPC_URL: rpcUrl,
        ESCROW_CONTRACT_ID: contractId,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.SOROBAN_RPC_URL).toBe(rpcUrl);
        expect(result.data.ESCROW_CONTRACT_ID).toBe(contractId);
      }
    });
  });

  // -------------------------------------------------------------------------
  // State 3: adapter = "soroban" without required credentials — must fail
  // -------------------------------------------------------------------------
  describe('state 3: SOROBAN_ADAPTER=soroban without credentials (must fail)', () => {
    it('rejects when both SOROBAN_RPC_URL and ESCROW_CONTRACT_ID are missing', () => {
      const result = envSchema.safeParse({
        ...BASE_ENV,
        SOROBAN_ADAPTER: 'soroban',
      });
      expect(result.success).toBe(false);
    });

    it('reports a clear error for missing SOROBAN_RPC_URL', () => {
      const result = envSchema.safeParse({
        ...BASE_ENV,
        SOROBAN_ADAPTER: 'soroban',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map(i => i.path.join('.'));
        expect(paths).toContain('SOROBAN_RPC_URL');
        const rpcIssue = result.error.issues.find(i => i.path.includes('SOROBAN_RPC_URL'));
        expect(rpcIssue?.message).toMatch(/SOROBAN_RPC_URL is required when SOROBAN_ADAPTER=soroban/);
      }
    });

    it('reports a clear error for missing ESCROW_CONTRACT_ID', () => {
      const result = envSchema.safeParse({
        ...BASE_ENV,
        SOROBAN_ADAPTER: 'soroban',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map(i => i.path.join('.'));
        expect(paths).toContain('ESCROW_CONTRACT_ID');
        const contractIssue = result.error.issues.find(i => i.path.includes('ESCROW_CONTRACT_ID'));
        expect(contractIssue?.message).toMatch(
          /ESCROW_CONTRACT_ID is required when SOROBAN_ADAPTER=soroban/,
        );
      }
    });

    it('rejects when only SOROBAN_RPC_URL is supplied (contract ID still missing)', () => {
      const result = envSchema.safeParse({
        ...BASE_ENV,
        SOROBAN_ADAPTER: 'soroban',
        SOROBAN_RPC_URL: 'https://soroban-rpc.example.com',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map(i => i.path.join('.'));
        expect(paths).toContain('ESCROW_CONTRACT_ID');
        expect(paths).not.toContain('SOROBAN_RPC_URL');
      }
    });

    it('rejects when only ESCROW_CONTRACT_ID is supplied (RPC URL still missing)', () => {
      const result = envSchema.safeParse({
        ...BASE_ENV,
        SOROBAN_ADAPTER: 'soroban',
        ESCROW_CONTRACT_ID: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2B',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map(i => i.path.join('.'));
        expect(paths).toContain('SOROBAN_RPC_URL');
        expect(paths).not.toContain('ESCROW_CONTRACT_ID');
      }
    });

    it('rejects an invalid URL for SOROBAN_RPC_URL even when adapter=soroban', () => {
      const result = envSchema.safeParse({
        ...BASE_ENV,
        SOROBAN_ADAPTER: 'soroban',
        SOROBAN_RPC_URL: 'not-a-url',
        ESCROW_CONTRACT_ID: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2B',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const rpcIssue = result.error.issues.find(i => i.path.includes('SOROBAN_RPC_URL'));
        expect(rpcIssue).toBeDefined();
      }
    });
  });

  // -------------------------------------------------------------------------
  // State 4: adapter = "soroban" with both credentials — must succeed
  // -------------------------------------------------------------------------
  describe('state 4: SOROBAN_ADAPTER=soroban with both credentials (must succeed)', () => {
    const SOROBAN_ENV = {
      ...BASE_ENV,
      SOROBAN_ADAPTER: 'soroban',
      SOROBAN_RPC_URL: 'https://soroban-rpc.example.com',
      ESCROW_CONTRACT_ID: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2B',
    };

    it('accepts a valid soroban configuration', () => {
      const result = envSchema.safeParse(SOROBAN_ENV);
      expect(result.success).toBe(true);
    });

    it('parses SOROBAN_ADAPTER as "soroban" in output', () => {
      const result = envSchema.safeParse(SOROBAN_ENV);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.SOROBAN_ADAPTER).toBe('soroban');
        expect(result.data.SOROBAN_RPC_URL).toBe('https://soroban-rpc.example.com');
        expect(result.data.ESCROW_CONTRACT_ID).toBe(
          'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2B',
        );
      }
    });
  });

  // -------------------------------------------------------------------------
  // Guard: invalid SOROBAN_ADAPTER value
  // -------------------------------------------------------------------------
  describe('SOROBAN_ADAPTER enum guard', () => {
    it('rejects an unknown adapter value', () => {
      const result = envSchema.safeParse({
        ...BASE_ENV,
        SOROBAN_ADAPTER: 'horizon',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find(i => i.path.includes('SOROBAN_ADAPTER'));
        expect(issue).toBeDefined();
      }
    });
  });
});
