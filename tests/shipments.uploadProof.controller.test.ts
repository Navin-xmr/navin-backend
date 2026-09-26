import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import type { Request, Response } from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Explicitly typed mocks to avoid TS narrowing return type to `never`
const mockSendResponse = jest.fn<(...args: unknown[]) => void>();
const mockUploadShipmentProofService = jest.fn<(...args: unknown[]) => Promise<unknown>>();

// Every binding shipments.controller.ts imports from ./shipments.service.js.
// Kept as a plain record so the drift guard below can compare it against the
// controller's real import statement.
const mockShipmentsServiceExports = {
  getShipmentsService: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  getShipmentByIdService: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  getShipmentTimelineService: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  createShipmentService: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  patchShipmentService: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  updateShipmentStatusService: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  bulkUpdateShipmentStatusService: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  uploadShipmentProofService: mockUploadShipmentProofService,
  createDisputeService: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  deleteShipmentService: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  getShipmentEtaService: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  exportShipmentsService: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  shipmentsToCSV: jest.fn<(...args: unknown[]) => string>(),
  uploadShipmentDocumentService: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  uploadShipmentPhotoService: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  DOCUMENT_UPLOAD_CONSTRAINTS: {
    mimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
    maxSize: 10 * 1024 * 1024,
  },
  PHOTO_UPLOAD_CONSTRAINTS: {
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
    maxSize: 5 * 1024 * 1024,
    maxPerShipment: 10,
  },
};

// src/shared/http/errors.js is a pure module (no config/DB imports), so the
// real AppError + ErrorCodes are used rather than a hand-rolled stand-in: a
// local stub is what previously left `ErrorCodes` unexported and broke ESM
// linking of shipments.controller.js.

await jest.unstable_mockModule('../src/shared/http/sendResponse.js', () => ({
  sendResponse: mockSendResponse,
}));

// Must export ALL named exports the controller imports from the service.
// An ESM module mock missing any of them fails at link time, so the surface is
// asserted against the controller source in the drift guard below.
await jest.unstable_mockModule(
  '../src/modules/shipments/shipments.service.js',
  () => mockShipmentsServiceExports
);

// Mock model so the controller can be imported without a DB connection
await jest.unstable_mockModule('../src/modules/shipments/shipments.model.js', () => ({
  Shipment: {},
  ShipmentStatus: {
    CREATED: 'CREATED',
    IN_TRANSIT: 'IN_TRANSIT',
    DELIVERED: 'DELIVERED',
    CANCELLED: 'CANCELLED',
  },
}));

const { uploadShipmentProof } = await import(
  '../src/modules/shipments/shipments.controller.js'
);

const { multerFile } = await import('./fixtures/factories.js');

/**
 * Reads the named bindings that shipments.controller.ts imports from
 * ./shipments.service.js straight out of the source file.
 */
function readControllerServiceImports(): string[] {
  const controllerPath = fileURLToPath(
    new URL('../src/modules/shipments/shipments.controller.ts', import.meta.url)
  );
  const source = readFileSync(controllerPath, 'utf8');
  // `[^}]*` (rather than a lazy dot-star) so the match cannot start at an
  // earlier import statement and swallow the whole file in between.
  const importBlock = source.match(
    /import\s*\{([^}]*)\}\s*from\s*'\.\/shipments\.service\.js'/
  );
  if (!importBlock?.[1]) {
    throw new Error('Could not locate the shipments.service.js import in shipments.controller.ts');
  }
  return importBlock[1]
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

describe('shipments.service.js mock surface', () => {
  it('stubs every binding the controller statically imports', () => {
    const controllerImports = readControllerServiceImports();
    const mocked = Object.keys(mockShipmentsServiceExports);

    // Every import the controller performs must resolve against the mock,
    // otherwise ESM linking throws before a single test body runs.
    expect([...controllerImports].sort()).toEqual(mocked.sort());
  });

  it('does not stub anything the controller does not import', () => {
    const controllerImports = new Set(readControllerServiceImports());
    const extra = Object.keys(mockShipmentsServiceExports).filter(
      (name) => !controllerImports.has(name)
    );
    expect(extra).toEqual([]);
  });
});

describe('Shipments Controller › uploadShipmentProof (Issue #200)', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;

  beforeEach(() => {
    jest.clearAllMocks();
    req = {
      params: { id: 'shipment123' },
      body: {},
      file: undefined,
    };
    res = {
      status: jest.fn().mockReturnThis() as unknown as Response['status'],
      json: jest.fn() as unknown as Response['json'],
    };
  });

  it('calls sendResponse exactly once on successful upload', async () => {
    req.body = { recipientSignatureName: 'John Doe', notes: 'Left at door' };
    req.file = multerFile({ size: 1024, buffer: Buffer.from('fake-image-data') });

    const mockUpdatedShipment = {
      _id: 'shipment123',
      deliveryProof: { url: 'http://fake.url/proof.jpg' },
    };
    mockUploadShipmentProofService.mockResolvedValueOnce(mockUpdatedShipment);

    await uploadShipmentProof(req as Request, res as Response);

    // Core assertion: sendResponse called exactly ONCE (Issue #200 fix)
    expect(mockSendResponse).toHaveBeenCalledTimes(1);
    expect(mockSendResponse).toHaveBeenCalledWith(
      res,
      200,
      true,
      'Proof uploaded',
      mockUpdatedShipment
    );

    // Service received correct arguments
    expect(mockUploadShipmentProofService).toHaveBeenCalledWith('shipment123', req.file, {
      recipientSignatureName: 'John Doe',
      notes: 'Left at door',
    });
  });

  it('throws AppError(400) when no file is uploaded — sendResponse not called', async () => {
    req.file = undefined;

    await expect(uploadShipmentProof(req as Request, res as Response)).rejects.toThrow(
      'No file uploaded'
    );

    expect(mockUploadShipmentProofService).not.toHaveBeenCalled();
    // Verify no response was sent (no ERR_HTTP_HEADERS_SENT)
    expect(mockSendResponse).not.toHaveBeenCalled();
  });

  it('propagates service errors without calling sendResponse', async () => {
    req.file = multerFile({ size: 1024, buffer: Buffer.from('fake-image-data') });

    const serviceError = new Error('Storage unavailable');
    mockUploadShipmentProofService.mockRejectedValueOnce(serviceError);

    await expect(uploadShipmentProof(req as Request, res as Response)).rejects.toThrow(
      'Storage unavailable'
    );

    // Error handler owns the response — sendResponse must not fire
    expect(mockSendResponse).not.toHaveBeenCalled();
  });

  it('passes undefined recipientSignatureName and notes when body is empty', async () => {
    req.body = {};
    req.file = multerFile({ size: 1024, buffer: Buffer.from('fake-image-data') });

    mockUploadShipmentProofService.mockResolvedValueOnce({ _id: 'shipment123' });

    await uploadShipmentProof(req as Request, res as Response);

    expect(mockSendResponse).toHaveBeenCalledTimes(1);
    expect(mockUploadShipmentProofService).toHaveBeenCalledWith('shipment123', req.file, {
      recipientSignatureName: undefined,
      notes: undefined,
    });
  });
});
