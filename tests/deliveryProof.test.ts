import { jest, describe, beforeAll, beforeEach, it, expect } from '@jest/globals';
import request from 'supertest';
import { fileURLToPath } from 'node:url';
import type { Application } from 'express';

type PrimitiveId = string | number;
type ShipmentRecord = {
  _id: string;
  milestones?: Array<Record<string, unknown>>;
} & Record<string, unknown>;

type UserRecord = { _id: string; email: string; passwordHash: string; role: string } & Record<string, unknown>;

const authUsers: UserRecord[] = [];

const shipmentsData: ShipmentRecord[] = [];

await jest.unstable_mockModule('../src/modules/shipments/shipments.model.js', () => {
  type ShipmentInput = Record<string, unknown> & {
    milestones?: Array<Record<string, unknown>>;
  };
  type ShipmentCtor = {
    new (doc: ShipmentInput): ShipmentRecord;
    create: (doc: ShipmentInput) => Promise<ShipmentRecord>;
    find: (_query: Record<string, unknown>) => {
      skip: (_s: number) => {
        limit: (_l: number) => Promise<ShipmentRecord[]>;
      };
    };
    countDocuments: () => Promise<number>;
    findByIdAndUpdate: (id: PrimitiveId, update: Record<string, unknown>, opts?: { new?: boolean }) => Promise<ShipmentRecord | null>;
  };

  const ShipmentConstructor = function (this: ShipmentRecord, doc: ShipmentInput) {
    Object.assign(this, doc);
    this.milestones = doc.milestones || [];
  } as unknown as ShipmentCtor;

  ShipmentConstructor.create = (doc) => {
    const d = { ...doc, _id: String(shipmentsData.length) };
    shipmentsData.push(d as ShipmentRecord);
    return Promise.resolve(d);
  };

  ShipmentConstructor.find = (_query) => ({
    skip: (_s: number) => ({
      limit: (_l: number) => Promise.resolve(shipmentsData),
    }),
  });

  ShipmentConstructor.countDocuments = () => Promise.resolve(shipmentsData.length);

  ShipmentConstructor.findByIdAndUpdate = (id, update, opts) => {
    const idx = shipmentsData.findIndex((d) => String(d._id) === String(id));
    if (idx === -1) return Promise.resolve(null);
    shipmentsData[idx] = { ...shipmentsData[idx], ...update } as ShipmentRecord;
    return Promise.resolve(opts?.new ? shipmentsData[idx] : null);
  };

  const ShipmentStatus = { CREATED: 'CREATED', IN_TRANSIT: 'IN_TRANSIT', DELIVERED: 'DELIVERED', CANCELLED: 'CANCELLED' };
  return { Shipment: ShipmentConstructor, ShipmentStatus };
});

describe('POST /api/shipments/:id/proof', () => {
  let app: Application;
  let managerToken: string;

  beforeAll(async () => {
    const appModule = await import('../src/app.js');
    app = appModule.buildApp();
    const { default: jwt } = await import('jsonwebtoken');
    managerToken = jwt.sign({ userId: 'manager-1', role: 'MANAGER' }, process.env.JWT_SECRET || 'secret');
  });

  beforeEach(() => {
    shipmentsData.length = 0;
  });

  it('should mock upload and update shipment with proof metadata', async () => {
    const shipmentModel = await import('../src/modules/shipments/shipments.model.js');
    const shipment = await shipmentModel.Shipment.create({
      trackingNumber: 'TN-PROOF',
      origin: 'A',
      destination: 'B',
      enterpriseId: 'ent1',
      logisticsId: 'log1',
      status: 'CREATED',
    });

    const imagePath = fileURLToPath(new URL('./fixtures/test-image.jpg', import.meta.url));
    const res = await request(app)
      .post(`/api/shipments/${shipment._id}/proof`)
      .set('Authorization', `Bearer ${managerToken}`)
      .field('recipientSignatureName', 'John Doe')
      .attach('file', imagePath);

    expect(res.status).toBe(200);
    expect(res.body.data.deliveryProof.url).toMatch(/^https:\/\/mock-storage\.com\/proof/);
    expect(res.body.data.deliveryProof.recipientSignatureName).toBe('John Doe');
    expect(res.body.data.deliveryProof.uploadedAt).toBeDefined();
  });

  it('should save optional notes when uploading proof', async () => {
    const shipmentModel = await import('../src/modules/shipments/shipments.model.js');
    const shipment = await shipmentModel.Shipment.create({
      trackingNumber: 'TN-PROOF-NOTE',
      origin: 'A',
      destination: 'B',
      enterpriseId: 'ent1',
      logisticsId: 'log1',
      status: 'CREATED',
    });

    const imagePath = fileURLToPath(new URL('./fixtures/test-image.jpg', import.meta.url));
    const res = await request(app)
      .post(`/api/shipments/${shipment._id}/proof`)
      .set('Authorization', `Bearer ${managerToken}`)
      .field('recipientSignatureName', 'Jane Doe')
      .field('notes', 'Package delivered with signature')
      .attach('file', imagePath);

    expect(res.status).toBe(200);
    expect(res.body.data.deliveryProof.notes).toBe('Package delivered with signature');
  });

  it('should return 400 when file is missing', async () => {
    const shipmentModel = await import('../src/modules/shipments/shipments.model.js');
    const shipment = await shipmentModel.Shipment.create({
      trackingNumber: 'TN-NO-FILE',
      origin: 'A',
      destination: 'B',
      enterpriseId: 'ent1',
      logisticsId: 'log1',
      status: 'CREATED',
    });

    const res = await request(app)
      .post(`/api/shipments/${shipment._id}/proof`)
      .set('Authorization', `Bearer ${managerToken}`)
      .field('recipientSignatureName', 'John Doe');

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('No file uploaded');
  });
});
