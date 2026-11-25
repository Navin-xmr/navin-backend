import { describe, expect, it, jest } from '@jest/globals';
import type { LookupAddress } from 'node:dns';
import { createPinnedPublicLookup } from '../src/modules/webhooks/chainWebhook.transport.js';

describe('chain webhook DNS pinning', () => {
  it.each([
    { address: '127.0.0.1', family: 4 },
    { address: '10.20.30.40', family: 4 },
    { address: '169.254.169.254', family: 4 },
    { address: 'fc00::1', family: 6 },
    { address: '2001:0db8::1', family: 6 },
  ])('rejects non-public DNS result $address', address => {
    expect(() => createPinnedPublicLookup([address])).toThrow(
      expect.objectContaining({ code: 'ERR_WEBHOOKS_ENDPOINT_NOT_PUBLIC' })
    );
  });

  it('pins lookups to the validated public address', () => {
    const pinned: LookupAddress = { address: '8.8.8.8', family: 4 };
    const lookup = createPinnedPublicLookup([pinned]);
    const callback = jest.fn();

    lookup('subscriber.example.test', { all: true }, callback);

    expect(callback).toHaveBeenCalledWith(null, [pinned]);
  });

  it('rejects a hostname with both public and private DNS results', () => {
    expect(() =>
      createPinnedPublicLookup([
        { address: '8.8.8.8', family: 4 },
        { address: '192.168.1.10', family: 4 },
      ])
    ).toThrow(expect.objectContaining({ code: 'ERR_WEBHOOKS_ENDPOINT_NOT_PUBLIC' }));
  });
});
