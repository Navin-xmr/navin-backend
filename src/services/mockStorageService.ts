/**
 * Placeholder storage adapter used until a real object-storage provider is wired
 * (see issue [#375](https://github.com/Navin-xmr/navin-backend/issues/375) and
 * `docs/storage-adapter.md`).
 *
 * ## Adapter pattern
 *
 * Call sites (shipment proof / document / photo / dispute evidence uploads) depend
 * on a narrow **StorageAdapter** contract rather than a specific cloud SDK:
 *
 * ```ts
 * interface StorageAdapter {
 *   uploadFile(
 *     buffer: Buffer,
 *     mimeType: string,
 *     key: string
 *   ): Promise<{ url: string; key: string }>;
 * }
 * ```
 *
 * This module is the temporary stand-in: it ignores the file bytes and returns a
 * fake HTTPS URL so upload flows can be exercised in local/dev without S3 or
 * Cloudinary credentials. When the real adapter lands, replace
 * `mockUploadToStorage` with a factory that selects the provider from
 * `STORAGE_PROVIDER` (and related env vars) while keeping the same return shape
 * (or a thin wrapper that maps `{ url, key }` to the string URL callers expect today).
 *
 * @param _file - Multer in-memory file (buffer + mimetype); unused by the mock.
 * @returns Resolves to a mock public URL after a short artificial delay.
 */
export const mockUploadToStorage = async (_file: Express.Multer.File): Promise<string> => {
  await new Promise(resolve => setTimeout(resolve, 1000));
  return `https://mock-storage.com/proof${Date.now()}.jpg`;
};
