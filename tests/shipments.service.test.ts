import { jest, describe, it, beforeAll, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AppError } from '../src/shared/http/errors.js';

const findByIdAndUpdateMock = jest.fn<(id: unknown, update: unknown, opts?: unknown) => Promise<unknown>>();
const anomalyUpdateManyMock = jest.fn<(query: unknown, update: unknown) => Promise<unknown>>();
const telemetryUpdateManyMock = jest.fn<(query: unknown, update: unknown) => Promise<unknown>>();
const uploadFileToStorageMock = jest.fn<(buffer: Buffer, mimeType: string, key: string) => Promise<string>>();
const createLedgerBlockServiceMock = jest.fn<(args: unknown) => Promise<unknown>>();

/**
 * The storage specifier that `shipments.service.ts` actually imports.
 *
 * Pointing this mock at anything else (for example a `mockStorageService.js`
 * that the service never imports) leaves the real adapter running, so the
 * upload assertions below are vacuous and the storage-failure case resolves
 * instead of rejecting. The "storage mock specifier" drift guard asserts the
 * value used here still matches the source.
 */
const UPLOAD_MODULE_SPECIFIER = '../../services/storage/upload.js';
const STORAGE_MOCK_SPECIFIER = '../src/services/storage/upload.js';

await jest.unstable_mockModule('../src/modules/shipments/shipments.model.js', () => ({
  Shipment: {
    findByIdAndUpdate: findByIdAndUpdateMock,
    findById: jest.fn(),
  },
  ShipmentStatus: {
    CREATED: 'CREATED',
    IN_TRANSIT: 'IN_TRANSIT',
    DELIVERED: 'DELIVERED',
    CANCELLED: 'CANCELLED',
  },
}));

await jest.unstable_mockModule('../src/modules/anomaly/anomaly.model.js', () => ({
  Anomaly: {
    updateMany: anomalyUpdateManyMock,
  },
}));

await jest.unstable_mockModule('../src/modules/telemetry/telemetry.model.js', () => ({
  Telemetry: {
    updateMany: telemetryUpdateManyMock,
  },
}));

await jest.unstable_mockModule(STORAGE_MOCK_SPECIFIER, () => ({
  uploadFileToStorage: uploadFileToStorageMock,
  deleteFileFromStorage: jest.fn(async () => undefined),
  getSignedUrl: jest.fn(async () => ''),
}));

await jest.unstable_mockModule('../src/modules/ledger/ledger.service.js', () => ({
  createLedgerBlockService: createLedgerBlockServiceMock,
}));

const { uploadShipmentProofService, deleteShipmentService } = await import('../src/modules/shipments/shipments.service.js');

const { multerFile } = await import('./fixtures/factories.js');

/** Extracts the module specifier `shipments.service.ts` imports uploadFileToStorage from. */
function readUploadSpecifierFromService(): string {
  const servicePath = fileURLToPath(
    new URL('../src/modules/shipments/shipments.service.ts', import.meta.url)
  );
  const source = readFileSync(servicePath, 'utf8');
  const match = source.match(
    /import\s*\{[^}]*\buploadFileToStorage\b[^}]*\}\s*from\s*'([^']+)'/
  );
  if (!match?.[1]) {
    throw new Error('Could not locate the uploadFileToStorage import in shipments.service.ts');
  }
  return match[1];
}

describe('storage upload mock specifier', () => {
  it('mocks the module specifier the service actually imports', () => {
    // tests/shipments.service.test.ts -> src/ + the service's own relative
    // specifier both have to resolve to the same file.
    expect(readUploadSpecifierFromService()).toBe(UPLOAD_MODULE_SPECIFIER);
    expect(STORAGE_MOCK_SPECIFIER).toBe('../src/services/storage/upload.js');
  });
});

describe('Shipments Service', () => {
  beforeAll(() => {
    findByIdAndUpdateMock.mockReset();
    anomalyUpdateManyMock.mockReset();
    telemetryUpdateManyMock.mockReset();
    uploadFileToStorageMock.mockReset();
    createLedgerBlockServiceMock.mockReset();
  });

  it('uploads proof and persists optional notes', async () => {
    uploadFileToStorageMock.mockResolvedValue('https://mock-storage.com/proof123.jpg');
    const proofResponse = {
      deliveryProof: {
        url: 'https://mock-storage.com/proof123.jpg',
        recipientSignatureName: 'Jane Doe',
        notes: 'Left at front desk',
        uploadedAt: new Date(),
      },
    };
    findByIdAndUpdateMock.mockResolvedValue(proofResponse);

    const file = multerFile();
    const result = await uploadShipmentProofService('shipment-1', file, {
      recipientSignatureName: 'Jane Doe',
      notes: 'Left at front desk',
    });

    // The upload must go through the mocked adapter, using the buffer and MIME
    // type from the multer file and a generated, per-shipment proof key.
    expect(uploadFileToStorageMock).toHaveBeenCalledTimes(1);
    const [buffer, mimeType, key] = uploadFileToStorageMock.mock.calls[0];
    expect(buffer).toBe(file.buffer);
    expect(mimeType).toBe('image/jpeg');
    expect(key).toMatch(/^shipments\/shipment-1\/proofs\/[0-9a-f-]{36}\.jpg$/);

    expect(findByIdAndUpdateMock).toHaveBeenCalledWith(
      'shipment-1',
      expect.objectContaining({
        deliveryProof: expect.objectContaining({
          url: 'https://mock-storage.com/proof123.jpg',
          recipientSignatureName: 'Jane Doe',
          notes: 'Left at front desk',
        }),
      }),
      { new: true }
    );
    expect(result).toBe(proofResponse);
  });

  it('returns AppError 503 when storage upload fails', async () => {
    uploadFileToStorageMock.mockRejectedValue(new Error('timeout'));

    const error = await uploadShipmentProofService('shipment-2', multerFile(), {
      recipientSignatureName: 'Jane Roe',
    }).then(
      () => undefined,
      (thrown: unknown) => thrown
    );

    expect(error).toBeInstanceOf(AppError);
    expect(error).toEqual(
      expect.objectContaining({
        statusCode: 503,
        message: 'Storage bucket unavailable, please try again later.',
      })
    );

    // A failed upload must not leave a half-written proof behind.
    expect(findByIdAndUpdateMock).not.toHaveBeenCalled();
    expect(createLedgerBlockServiceMock).not.toHaveBeenCalled();
  });

  it('rethrows an AppError raised by the storage layer without re-wrapping it', async () => {
    const storageError = new AppError(502, 'Storage service unavailable. Please try again later.', 'STORAGE_ERROR');
    uploadFileToStorageMock.mockRejectedValue(storageError);

    await expect(
      uploadShipmentProofService('shipment-2b', multerFile(), { recipientSignatureName: 'Jane Roe' })
    ).rejects.toBe(storageError);

    expect(findByIdAndUpdateMock).not.toHaveBeenCalled();
  });

  it('returns AppError 404 when the shipment is gone after a successful upload', async () => {
    uploadFileToStorageMock.mockResolvedValue('https://mock-storage.com/proof404.jpg');
    findByIdAndUpdateMock.mockResolvedValue(null);

    await expect(
      uploadShipmentProofService('shipment-missing', multerFile(), {})
    ).rejects.toEqual(
      expect.objectContaining({
        statusCode: 404,
        message: 'Shipment not found',
      })
    );
  });

  it('soft deletes shipment and cascades deletedAt onto anomalies and telemetry', async () => {
    findByIdAndUpdateMock.mockResolvedValue({ _id: 'shipment-3', deletedAt: new Date() });
    anomalyUpdateManyMock.mockResolvedValue({});
    telemetryUpdateManyMock.mockResolvedValue({});

    const result = await deleteShipmentService('shipment-3');

    expect(findByIdAndUpdateMock).toHaveBeenCalledWith('shipment-3', expect.objectContaining({ deletedAt: expect.any(Date) }), { new: true });
    expect(anomalyUpdateManyMock).toHaveBeenCalledWith({ shipmentId: 'shipment-3' }, expect.objectContaining({ deletedAt: expect.any(Date) }));
    expect(telemetryUpdateManyMock).toHaveBeenCalledWith({ shipmentId: 'shipment-3' }, expect.objectContaining({ deletedAt: expect.any(Date) }));
    expect(result).toEqual({ _id: 'shipment-3', deletedAt: expect.any(Date) });
  });
});
