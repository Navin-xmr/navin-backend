import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { createStellarServiceMock } from './helpers/mocks.js';
import type { IPayment, PaymentStatus } from '../src/modules/payments/payments.model.js';
import { Types } from 'mongoose';

const PAYMENT_ID = new Types.ObjectId().toString();
const SHIPMENT_ID = new Types.ObjectId().toString();
const ORGANIZATION_ID = new Types.ObjectId().toString();

const mockCreatePayment = jest.fn<(...args: unknown[]) => Promise<IPayment>>();

await jest.unstable_mockModule('../src/modules/payments/payments.repo.js', () => ({
  createPayment: mockCreatePayment,
  getPaymentById: jest.fn(),
  getPaymentsByOrganization: jest.fn(),
  updatePaymentStatus: jest.fn(),
  getPaymentByShipmentId: jest.fn(),
  deletePayment: jest.fn(),
  aggregateSettlementSummary: jest.fn(),
  buildSettlementSparkline: jest.fn(),
  disputePayment: jest.fn(),
}));

await jest.unstable_mockModule('../src/services/stellar.service.js', () => createStellarServiceMock());

const { createPaymentService } = await import('../src/modules/payments/payments.service.js');
const { AppError } = await import('../src/shared/http/errors.js');

describe('Issue #265: createPaymentService error handling', () => {
  beforeEach(() => {
    mockCreatePayment.mockReset();
  });

  it('creates a payment successfully with valid data', async () => {
    const paymentData = {
      _id: PAYMENT_ID,
      shipmentId: SHIPMENT_ID,
      organizationId: ORGANIZATION_ID,
      amount: 100,
      token: 'USDC',
      tokenType: 'USDC',
      status: 'Pending' as PaymentStatus,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockCreatePayment.mockResolvedValue(paymentData as unknown as IPayment);

    const result = await createPaymentService({
      shipmentId: SHIPMENT_ID,
      organizationId: ORGANIZATION_ID,
      amount: 100,
      token: 'USDC',
      status: 'Pending' as PaymentStatus,
    });

    expect(mockCreatePayment).toHaveBeenCalledWith(
      expect.objectContaining({
        shipmentId: SHIPMENT_ID,
        organizationId: ORGANIZATION_ID,
        amount: 100,
        token: 'USDC',
      })
    );
    expect(result).toHaveProperty('explorerUrl');
  });

  it('propagates Mongoose ValidationError without wrapping', async () => {
    const mongooseError = new Error('Shipment validation failed');
    mongooseError.name = 'ValidationError';
    mockCreatePayment.mockRejectedValue(mongooseError);

    await expect(
      createPaymentService({
        shipmentId: 'invalid',
        organizationId: ORGANIZATION_ID,
        amount: -1,
        token: 'USDC',
        status: 'Pending' as PaymentStatus,
      })
    ).rejects.toThrow('Shipment validation failed');
  });

  it('propagates duplicate key errors without wrapping', async () => {
    const dupError = new Error('duplicate key error') as Error & {
      code: number;
      keyValue: Record<string, unknown>;
    };
    dupError.code = 11000;
    dupError.keyValue = { shipmentId: SHIPMENT_ID };
    mockCreatePayment.mockRejectedValue(dupError);

    await expect(
      createPaymentService({
        shipmentId: SHIPMENT_ID,
        organizationId: ORGANIZATION_ID,
        amount: 100,
        token: 'USDC',
        status: 'Pending' as PaymentStatus,
      })
    ).rejects.toThrow('duplicate key error');
  });

  it('propagates generic errors without converting to 500', async () => {
    const genericError = new Error('Database connection lost');
    mockCreatePayment.mockRejectedValue(genericError);

    await expect(
      createPaymentService({
        shipmentId: SHIPMENT_ID,
        organizationId: ORGANIZATION_ID,
        amount: 100,
        token: 'USDC',
        status: 'Pending' as PaymentStatus,
      })
    ).rejects.toThrow('Database connection lost');
  });

  it('does not throw AppError for validation-related errors', async () => {
    const validationError = new Error('Path validation failed for amount');
    mockCreatePayment.mockRejectedValue(validationError);

    try {
      await createPaymentService({
        shipmentId: SHIPMENT_ID,
        organizationId: ORGANIZATION_ID,
        amount: 100,
        token: 'USDC',
        status: 'Pending' as PaymentStatus,
      });
      fail('Expected error to be thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(AppError);
    }
  });
});
