import { describe, it, expect } from '@jest/globals';
import { paginateCursor, offsetSkip, cursorMeta, offsetMeta } from '../pagination.js';
import { TelemetryQuerySchema } from '../../../modules/telemetry/telemetry.validation.js';

describe('pagination helpers', () => {
  it('paginateCursor returns nextCursor when over-fetched', () => {
    const items = [{ _id: '1' }, { _id: '2' }, { _id: '3' }];
    const page = paginateCursor(items, 2);
    expect(page.data).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe('2');
  });

  it('paginateCursor returns null cursor on last page', () => {
    const items = [{ _id: '1' }, { _id: '2' }];
    const page = paginateCursor(items, 2);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it('offsetSkip uses 1-based pages', () => {
    expect(offsetSkip(1, 20)).toBe(0);
    expect(offsetSkip(3, 10)).toBe(20);
  });

  it('meta builders match envelope contract', () => {
    expect(cursorMeta({ nextCursor: 'abc', hasMore: true })).toEqual({
      nextCursor: 'abc',
      hasMore: true,
    });
    expect(offsetMeta(2, 20, 55)).toEqual({ page: 2, limit: 20, total: 55 });
  });
});

describe('TelemetryQuerySchema pagination refine', () => {
  it('rejects cursor and page together', () => {
    const result = TelemetryQuerySchema.safeParse({ cursor: 'abc', page: 1, limit: 10 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some(i => i.message.includes('cursor or page'))).toBe(true);
    }
  });

  it('accepts cursor alone', () => {
    const result = TelemetryQuerySchema.safeParse({ cursor: 'abc', limit: 10 });
    expect(result.success).toBe(true);
  });

  it('accepts page alone', () => {
    const result = TelemetryQuerySchema.safeParse({ page: 2, limit: 10 });
    expect(result.success).toBe(true);
  });
});
