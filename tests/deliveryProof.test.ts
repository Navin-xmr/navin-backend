import { jest } from '@jest/globals';
import request from 'supertest';
import { fileURLToPath } from 'node:url';

const shipmentsData: any[] = [];

await jest.unstable_mockModule('../src/modules/shipments/shipments.model', () => {
  function ShipmentConstructor(this: any, doc: any) {
    Object.assign(this, doc);
    this.milestones = doc.milestones || [];
  }

  ShipmentConstructor.create = (doc: any) => {
    const d = { ...doc, _id: String(shipmentsData.length) };
    shipmentsData.push(d);
    return Promise.resolve(d);
  };

  ShipmentConstructor.find = (_query: any) => ({
    skip: (_s: number) => ({
      limit: (_l: number) => Promise.resolve(shipmentsData),
    }),
  });

  ShipmentConstructor.countDocuments = () => Promise.resolve(shipmentsData.length);

  ShipmentConstructor.findByIdAndUpdate = (id: any, update: any, opts: any) => {
    const idx = shipmentsData.findIndex((d) => String(d._id) === String(id));
    if (idx === -1) return Promise.resolve(null);
    shipmentsData[idx] = { ...shipmentsData[idx], ...update };
    return Promise.resolve(opts?.new ? shipmentsData[idx] : null);
  };

  const ShipmentStatus = { CREATED: 'CREATED', IN_TRANSIT: 'IN_TRANSIT', DELIVERED: 'DELIVERED', CANCELLED: 'CANCELLED' };
  return { Shipment: ShipmentConstructor, ShipmentStatus };
});

describe('POST /api/shipments/:id/proof', () => {
  let app: any;

  beforeAll(async () => {
    const appModule = await import('../src/app.js');
    app = appModule.buildApp();
  });

  beforeEach(() => {
    shipmentsData.length = 0;
  });

  it('should mock upload and update shipment with proof metadata', async () => {
    const shipmentModel = await import('../src/modules/shipments/shipments.model');
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
      .field('recipientSignatureName', 'John Doe')
      .attach('file', imagePath);

    expect(res.status).toBe(200);
    expect(res.body.shipment.deliveryProof.url).toMatch(/^https:\/\/mock-storage\.com\/proof/);
    expect(res.body.shipment.deliveryProof.recipientSignatureName).toBe('John Doe');
    expect(res.body.shipment.deliveryProof.uploadedAt).toBeDefined();
  });

  it('should return 400 when file is missing', async () => {
    const shipmentModel = await import('../src/modules/shipments/shipments.model');
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
      .field('recipientSignatureName', 'John Doe');

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('No file uploaded');
  });
});
