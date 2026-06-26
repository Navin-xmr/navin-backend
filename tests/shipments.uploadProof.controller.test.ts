import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import type { Request, Response } from 'express';

// Explicitly typed mocks to avoid TS narrowing return type to `never`
const mockSendResponse = jest.fn<(...args: unknown[]) => void>();
const mockUploadShipmentProofService = jest.fn<(...args: unknown[]) => Promise<unknown>>();

const mockAppError = class AppError extends Error {
  statusCode: number;
  code: string;
  constructor(statusCode: number, message: string, code: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
};

await jest.unstable_mockModule('../src/shared/http/sendResponse.js', () => ({
  sendResponse: mockSendResponse,
}));

await jest.unstable_mockModule('../src/shared/http/errors.js', () => ({
  AppError: mockAppError,
}));

// Must export ALL named exports the controller imports from the service
await jest.unstable_mockModule('../src/modules/shipments/shipments.service.js', () => ({
  getShipmentsService: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  createShipmentService: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  patchShipmentService: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  updateShipmentStatusService: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  uploadShipmentProofService: mockUploadShipmentProofService,
  deleteShipmentService: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  findShipments: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

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
    req.file = {
      fieldname: 'file',
      originalname: 'proof.jpg',
      encoding: '7bit',
      mimetype: 'image/jpeg',
      size: 1024,
      buffer: Buffer.from('fake-image-data'),
    } as Express.Multer.File;

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
    req.file = {
      fieldname: 'file',
      originalname: 'proof.jpg',
      encoding: '7bit',
      mimetype: 'image/jpeg',
      size: 1024,
      buffer: Buffer.from('fake-image-data'),
    } as Express.Multer.File;

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
    req.file = {
      fieldname: 'file',
      originalname: 'proof.jpg',
      encoding: '7bit',
      mimetype: 'image/jpeg',
      size: 1024,
      buffer: Buffer.from('fake-image-data'),
    } as Express.Multer.File;

    mockUploadShipmentProofService.mockResolvedValueOnce({ _id: 'shipment123' });

    await uploadShipmentProof(req as Request, res as Response);

    expect(mockSendResponse).toHaveBeenCalledTimes(1);
    expect(mockUploadShipmentProofService).toHaveBeenCalledWith('shipment123', req.file, {
      recipientSignatureName: undefined,
      notes: undefined,
    });
  });
});
