import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { AppError, ErrorCodes } from '../../shared/http/errors.js';

function isPublicAddress(address: string, family: number): boolean {
  if (family === 4) {
    const octets = address.split('.').map(Number);
    if (
      octets.length !== 4 ||
      octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)
    ) {
      return false;
    }
    const [first, second, third] = octets;
    return !(
      first === 0 ||
      first === 10 ||
      first === 127 ||
      first >= 224 ||
      (first === 100 && second !== undefined && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 192 && second === 0) ||
      (first === 192 && second === 88 && third === 99) ||
      (first === 198 && (second === 18 || second === 19)) ||
      (first === 198 && second === 51 && third === 100) ||
      (first === 203 && second === 0 && third === 113)
    );
  }

  const normalized = address.toLowerCase();
  return (
    family === 6 &&
    /^[23][0-9a-f]{0,3}:/.test(normalized) &&
    !/^2001:0*db8:/.test(normalized) &&
    !normalized.startsWith('::ffff:')
  );
}

/**
 * Creates a DNS lookup callback pinned to validated public addresses.
 *
 * @param addresses - DNS results to validate and pin.
 * @returns A lookup callback that returns only the first validated address.
 * @throws {AppError} 400 ERR_WEBHOOKS_ENDPOINT_NOT_PUBLIC if any result is private or reserved.
 */
export function createPinnedPublicLookup(addresses: LookupAddress[]): LookupFunction {
  if (
    addresses.length === 0 ||
    addresses.some(entry => !isPublicAddress(entry.address, entry.family))
  ) {
    throw new AppError(
      400,
      'Chain webhook endpoint must resolve only to public IP addresses',
      ErrorCodes.WEBHOOKS_ENDPOINT_NOT_PUBLIC
    );
  }

  const address = addresses[0]!;
  return (_hostname, options, callback) => {
    if (options.all) callback(null, [address]);
    else callback(null, address.address, address.family);
  };
}

/**
 * Sends an HTTPS request to a DNS-resolved public address and pins the TLS socket to it.
 *
 * @param endpoint - Subscriber URL.
 * @param body - Serialized webhook request body.
 * @param headers - Signed request headers.
 * @returns Subscriber HTTP status code.
 * @throws {AppError} 400 ERR_WEBHOOKS_ENDPOINT_NOT_PUBLIC if DNS resolves to a private/reserved address.
 * @throws {Error} On DNS, TLS, or network failure.
 */
export async function postChainWebhookRequest(
  endpoint: string,
  body: string,
  headers: Record<string, string>
): Promise<number> {
  const url = new URL(endpoint);
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  const pinnedAddressLookup = createPinnedPublicLookup(addresses);

  return new Promise((resolve, reject) => {
    const clientRequest = httpsRequest(
      url,
      {
        method: 'POST',
        headers,
        lookup: pinnedAddressLookup,
        servername: url.hostname,
        signal: AbortSignal.timeout(10_000),
      },
      response => {
        response.resume();
        response.once('end', () => resolve(response.statusCode ?? 0));
        response.once('error', reject);
      }
    );
    clientRequest.once('error', reject);
    clientRequest.end(body);
  });
}
