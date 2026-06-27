import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockCreatePayment = jest.fn();

await jest.unstable_mockModule('../src/modules/payments/payments.repo.js', () => ({
  createPayment: mockCreatePayment,
  getPaymentById: jest.fn(),
  getPaymentsByOrganization: jest.fn(),
  updatePaymentStatus: jest.fn(),
  getPaymentByShipmentId: jest.fn(),
  deletePayment: jest.fn(),
}));

await jest.unstable_mockModule('../src/services/stellar.service.js', () => ({
  getStellarExplorerUrl: (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`,
  tokenizeShipment: jest.fn(),
  releaseEscrow: jest.fn(),
}));

const { createPaymentService } = await import('../src/modules/payments/payments.service.js');
const { AppError } = await import('../src/shared/http/errors.js');

describe('Issue #265: createPaymentService error handling', () => {
  beforeEach(() => {
    mockCreatePayment.mockReset();
  });

  it('creates a payment successfully with valid data', async () => {
    const paymentData = {
      _id: 'pay-1',
      shipmentId: 'ship-1',
      organizationId: 'org-1',
      amount: 100,
      tokenType: 'USDC',
      status: 'Pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockCreatePayment.mockResolvedValue(paymentData);

    const result = await createPaymentService({
      shipmentId: 'ship-1',
      organizationId: 'org-1',
      amount: 100,
      tokenType: 'USDC',
    });

    expect(mockCreatePayment).toHaveBeenCalledWith({
      shipmentId: 'ship-1',
      organizationId: 'org-1',
      amount: 100,
      tokenType: 'USDC',
      status: 'Pending',
    });
    expect(result).toHaveProperty('explorerUrl');
  });

  it('propagates Mongoose ValidationError without wrapping', async () => {
    const mongooseError = new Error('Shipment validation failed');
    mongooseError.name = 'ValidationError';
    mockCreatePayment.mockRejectedValue(mongooseError);

    await expect(
      createPaymentService({
        shipmentId: 'invalid',
        organizationId: 'org-1',
        amount: -1,
        tokenType: 'USDC',
      })
    ).rejects.toThrow('Shipment validation failed');
  });

  it('propagates duplicate key errors without wrapping', async () => {
    const dupError = new Error('duplicate key error') as Error & { code: number; keyValue: Record<string, unknown> };
    dupError.code = 11000;
    dupError.keyValue = { shipmentId: 'ship-1' };
    mockCreatePayment.mockRejectedValue(dupError);

    await expect(
      createPaymentService({
        shipmentId: 'ship-1',
        organizationId: 'org-1',
        amount: 100,
        tokenType: 'USDC',
      })
    ).rejects.toThrow('duplicate key error');
  });

  it('propagates generic errors without converting to 500', async () => {
    const genericError = new Error('Database connection lost');
    mockCreatePayment.mockRejectedValue(genericError);

    await expect(
      createPaymentService({
        shipmentId: 'ship-1',
        organizationId: 'org-1',
        amount: 100,
        tokenType: 'USDC',
      })
    ).rejects.toThrow('Database connection lost');
  });

  it('does not throw AppError for validation-related errors', async () => {
    const validationError = new Error('Path validation failed for amount');
    mockCreatePayment.mockRejectedValue(validationError);

    try {
      await createPaymentService({
        shipmentId: 'ship-1',
        organizationId: 'org-1',
        amount: 100,
        tokenType: 'USDC',
      });
      fail('Expected error to be thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(AppError);
    }
  });
});
