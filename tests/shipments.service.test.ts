import { jest, describe, it, beforeAll, expect } from '@jest/globals';
import type { Express } from 'express';

const findByIdAndUpdateMock = jest.fn();
const anomalyUpdateManyMock = jest.fn();
const telemetryUpdateManyMock = jest.fn();
const mockUploadToStorageMock = jest.fn();

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

await jest.unstable_mockModule('../src/services/mockStorageService.js', () => ({
  mockUploadToStorage: mockUploadToStorageMock,
}));

const { uploadShipmentProofService, deleteShipmentService } = await import('../src/modules/shipments/shipments.service.js');

describe('Shipments Service', () => {
  beforeAll(() => {
    findByIdAndUpdateMock.mockReset();
    anomalyUpdateManyMock.mockReset();
    telemetryUpdateManyMock.mockReset();
    mockUploadToStorageMock.mockReset();
  });

  it('uploads proof and persists optional notes', async () => {
    mockUploadToStorageMock.mockResolvedValue('https://mock-storage.com/proof123.jpg');
    const proofResponse = {
      deliveryProof: {
        url: 'https://mock-storage.com/proof123.jpg',
        recipientSignatureName: 'Jane Doe',
        notes: 'Left at front desk',
        uploadedAt: new Date(),
      },
    };
    findByIdAndUpdateMock.mockResolvedValue(proofResponse);

    const result = await uploadShipmentProofService('shipment-1', {
      originalname: 'proof.jpg',
      buffer: Buffer.from('fake'),
      mimetype: 'image/jpeg',
      size: 123,
      fieldname: 'file',
      destination: '',
      filename: 'proof.jpg',
      path: '',
      stream: null as unknown as NodeJS.ReadableStream,
    } as Express.Multer.File, {
      recipientSignatureName: 'Jane Doe',
      notes: 'Left at front desk',
    });

    expect(mockUploadToStorageMock).toHaveBeenCalled();
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
    mockUploadToStorageMock.mockRejectedValue(new Error('timeout'));

    await expect(
      uploadShipmentProofService('shipment-2', {
        originalname: 'proof.jpg',
        buffer: Buffer.from('fake'),
        mimetype: 'image/jpeg',
        size: 123,
        fieldname: 'file',
        destination: '',
        filename: 'proof.jpg',
        path: '',
        stream: null as unknown as NodeJS.ReadableStream,
      } as Express.Multer.File, {
        recipientSignatureName: 'Jane Roe',
      })
    ).rejects.toEqual(expect.objectContaining({ statusCode: 503, message: 'Storage bucket unavailable, please try again later.' }));
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
