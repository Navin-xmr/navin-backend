import { Types } from 'mongoose';
import { PaymentModel, PaymentStatus, type IPayment } from './payments.model.js';

export async function createPayment(input: {
  shipmentId: string | Types.ObjectId;
  organizationId: string | Types.ObjectId;
  amount: number;
  token: string;
  tokenType?: string;
  payerAddress?: string;
  payeeAddress?: string;
  status?: PaymentStatus;
}): Promise<IPayment> {
  return PaymentModel.create({
    shipmentId: new Types.ObjectId(input.shipmentId),
    organizationId: new Types.ObjectId(input.organizationId),
    amount: input.amount,
    token: input.token,
    tokenType: input.tokenType ?? input.token,
    payerAddress: input.payerAddress,
    payeeAddress: input.payeeAddress,
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
    shipmentId?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    limit?: number;
    cursor?: string;
    page?: number;
  }
): Promise<PaymentsPage> {
  const limit = filters?.limit ?? 20;
  const query: Record<string, unknown> = {
    organizationId: new Types.ObjectId(organizationId),
  };

  if (filters?.status) {
    query.status = filters.status;
  }

  if (filters?.shipmentId) {
    query.shipmentId = new Types.ObjectId(filters.shipmentId);
  }

  // Build sort object
  const sortBy = filters?.sortBy ?? 'createdAt';
  const sortOrder = filters?.sortOrder === 'asc' ? 1 : -1;
  const sort: Record<string, 1 | -1> = { [sortBy]: sortOrder, _id: sortOrder };

  // Pagination: prefer page-based if provided, otherwise cursor-based
  let data: IPayment[];
  const total = await PaymentModel.countDocuments({
    organizationId: new Types.ObjectId(organizationId),
    ...(filters?.status ? { status: filters.status } : {}),
    ...(filters?.shipmentId ? { shipmentId: new Types.ObjectId(filters.shipmentId) } : {}),
  });

  if (filters?.page !== undefined) {
    // Offset-based pagination
    const skip = Math.max(0, (filters.page - 1) * limit);
    data = await PaymentModel.find(query).sort(sort).skip(skip).limit(limit).lean();

    return {
      data,
      total,
      hasMore: skip + data.length < total,
      nextCursor: null,
    };
  } else {
    // Cursor-based pagination
    if (filters?.cursor) {
      query._id = { $lt: new Types.ObjectId(filters.cursor) };
    }

    data = await PaymentModel.find(query)
      .sort(sort)
      .limit(limit + 1)
      .lean();

    const hasMore = data.length > limit;
    if (hasMore) data.pop();

    return {
      data,
      total,
      hasMore,
      nextCursor: hasMore ? data[data.length - 1]._id.toString() : null,
    };
  }
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

export interface SettlementSummaryAggResult {
  totalReleased: number;
  totalInEscrow: number;
  totalPending: number;
}

export async function aggregateSettlementSummary(
  organizationId: string,
  since: Date
): Promise<SettlementSummaryAggResult> {
  const [result] = await PaymentModel.aggregate<SettlementSummaryAggResult>([
    {
      $match: {
        organizationId: new Types.ObjectId(organizationId),
        createdAt: { $gte: since },
      },
    },
    {
      $group: {
        _id: null,
        totalReleased: {
          $sum: { $cond: [{ $eq: ['$status', PaymentStatus.RELEASED] }, '$amount', 0] },
        },
        totalInEscrow: {
          $sum: { $cond: [{ $eq: ['$status', PaymentStatus.ESCROWED] }, '$amount', 0] },
        },
        totalPending: {
          $sum: { $cond: [{ $eq: ['$status', PaymentStatus.PENDING] }, '$amount', 0] },
        },
      },
    },
    {
      $project: { _id: 0, totalReleased: 1, totalInEscrow: 1, totalPending: 1 },
    },
  ]);

  return result ?? { totalReleased: 0, totalInEscrow: 0, totalPending: 0 };
}

export async function buildSettlementSparkline(
  organizationId: string,
  since: Date,
  days: number
): Promise<number[]> {
  const rows = await PaymentModel.aggregate<{ _id: string; total: number }>([
    {
      $match: {
        organizationId: new Types.ObjectId(organizationId),
        createdAt: { $gte: since },
        status: PaymentStatus.RELEASED,
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' },
        },
        total: { $sum: '$amount' },
      },
    },
  ]);

  const map = new Map<string, number>(rows.map(r => [r._id, r.total]));

  // Build a dense array of `days` entries starting from `since`
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(since);
    d.setUTCDate(d.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    return map.get(key) ?? 0;
  });
}

export async function disputePayment(
  id: string,
  disputeReason: string,
  additionalNotes?: string
): Promise<IPayment | null> {
  return PaymentModel.findByIdAndUpdate(
    id,
    {
      status: PaymentStatus.DISPUTED,
      'escrowRelease.disputedAt': new Date(),
      'escrowRelease.disputeReason': disputeReason,
      ...(additionalNotes ? { 'escrowRelease.additionalNotes': additionalNotes } : {}),
    },
    { new: true }
  ).lean();
}
