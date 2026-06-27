import { Types } from 'mongoose';
import { PaymentModel, PaymentStatus, type IPayment } from './payments.model.js';

export async function createPayment(input: {
  shipmentId: string | Types.ObjectId;
  organizationId: string | Types.ObjectId;
  amount: number;
  tokenType: string;
  status?: PaymentStatus;
}): Promise<IPayment> {
  return PaymentModel.create({
    shipmentId: new Types.ObjectId(input.shipmentId),
    organizationId: new Types.ObjectId(input.organizationId),
    amount: input.amount,
    tokenType: input.tokenType,
    status: input.status || PaymentStatus.PENDING,
  });
}

export async function getPaymentById(id: string): Promise<IPayment | null> {
  return PaymentModel.findById(id).lean();
}

export interface PaymentsPage {
  data: IPayment[];
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export async function getPaymentsByOrganization(
  organizationId: string,
  filters?: {
    status?: PaymentStatus;
    limit?: number;
    cursor?: string;
  }
): Promise<PaymentsPage> {
  const limit = filters?.limit ?? 20;
  const query: Record<string, unknown> = {
    organizationId: new Types.ObjectId(organizationId),
  };

  if (filters?.status) {
    query.status = filters.status;
  }

  if (filters?.cursor) {
    query._id = { $lt: new Types.ObjectId(filters.cursor) };
  }

  const [data, total] = await Promise.all([
    PaymentModel.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean(),
    PaymentModel.countDocuments({
      organizationId: new Types.ObjectId(organizationId),
      ...(filters?.status ? { status: filters.status } : {}),
    }),
  ]);

  const hasMore = data.length > limit;
  if (hasMore) data.pop();

  return {
    data,
    total,
    hasMore,
    nextCursor: hasMore ? data[data.length - 1]._id.toString() : null,
  };
}

export async function updatePaymentStatus(
  id: string,
  status: PaymentStatus,
  stellarTxHash?: string
): Promise<IPayment | null> {
  return PaymentModel.findByIdAndUpdate(
    id,
    {
      status,
      ...(stellarTxHash && { stellarTxHash }),
    },
    { new: true }
  ).lean();
}

export async function getPaymentByShipmentId(shipmentId: string): Promise<IPayment | null> {
  return PaymentModel.findOne({ shipmentId: new Types.ObjectId(shipmentId) }).lean();
}

export async function deletePayment(id: string): Promise<IPayment | null> {
  return PaymentModel.findByIdAndUpdate(id, { deletedAt: new Date() }, { new: true }).lean();
}
