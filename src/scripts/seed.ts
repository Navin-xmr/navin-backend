import '../loadEnv.js';
import mongoose, { Schema, Types } from 'mongoose';
import { faker } from '@faker-js/faker';
import {
  OrganizationModel,
  OrganizationType,
  UserModel,
  UserRole,
} from '../modules/users/users.model.js';
import { Shipment, ShipmentStatus } from '../modules/shipments/shipments.model.js';
import { connectMongo, disconnectMongo } from '../infra/mongo/connection.js';
import { env } from '../env.js';

const TelemetrySchema = new Schema(
  {
    shipmentId: { type: Types.ObjectId, ref: 'Shipment', required: true },
    temperature: { type: Number, required: true },
    humidity: { type: Number, required: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    batteryLevel: { type: Number, required: true },
    timestamp: { type: Date, required: true },
  },
  { timestamps: true }
);

const TelemetryModel = mongoose.model('Telemetry', TelemetrySchema);

const PaymentSchema = new Schema(
  {
    shipmentId: { type: Types.ObjectId, ref: 'Shipment', required: true },
    amount: { type: Number, required: true },
    currency: { type: String, required: true },
    status: { type: String, enum: ['pending', 'completed', 'failed'], required: true },
    method: { type: String, required: true },
    paidAt: { type: Date },
  },
  { timestamps: true }
);

const PaymentModel = mongoose.model('Payment', PaymentSchema);

const STATUSES = Object.values(ShipmentStatus);
const PAYMENT_STATUSES = ['pending', 'completed', 'failed'] as const;
const PAYMENT_METHODS = ['credit_card', 'bank_transfer', 'crypto', 'paypal'];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR'];

function milestoneNames(status: ShipmentStatus): string[] {
  switch (status) {
    case ShipmentStatus.CREATED:
      return ['Order Placed'];
    case ShipmentStatus.IN_TRANSIT:
      return ['Order Placed', 'Picked Up', 'In Transit'];
    case ShipmentStatus.DELIVERED:
      return ['Order Placed', 'Picked Up', 'In Transit', 'Out for Delivery', 'Delivered'];
    case ShipmentStatus.CANCELLED:
      return ['Order Placed', 'Cancelled'];
  }
}

async function seed() {
  if (env.NODE_ENV === 'production') {
    console.error('\x1b[31m✖ ABORT: Seeding is not allowed in production!\x1b[0m');
    process.exit(1);
  }

  const mongoUri = env.MONGO_URI;

  await connectMongo(mongoUri);

  console.log('\x1b[33m⏳ Wiping existing data…\x1b[0m');
  await Promise.all([
    OrganizationModel.deleteMany({}),
    UserModel.deleteMany({}),
    Shipment.deleteMany({}),
    TelemetryModel.deleteMany({}),
    PaymentModel.deleteMany({}),
  ]);
  console.log('\x1b[32m✔ All collections cleared\x1b[0m');

  console.log('\x1b[33m⏳ Seeding organizations…\x1b[0m');
  const enterprise = await OrganizationModel.create({
    name: faker.company.name() + ' Enterprises',
    type: OrganizationType.ENTERPRISE,
  });
  const logistics = await OrganizationModel.create({
    name: faker.company.name() + ' Logistics',
    type: OrganizationType.LOGISTICS,
  });
  console.log(`\x1b[32m✔ 2 organizations created\x1b[0m`);

  console.log('\x1b[33m⏳ Seeding users…\x1b[0m');
  const roles = [
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.VIEWER,
    UserRole.CUSTOMER,
  ];
  const users: Array<InstanceType<typeof UserModel>> = [];
  for (const role of roles) {
    const org = [UserRole.CUSTOMER, UserRole.VIEWER].includes(role) ? enterprise : logistics;
    const user = await UserModel.create({
      email: faker.internet.email().toLowerCase(),
      name: faker.person.fullName(),
      passwordHash: 'password123',
      role,
      organizationId: org._id,
      walletAddress: faker.finance.ethereumAddress(),
    });
    users.push(user);
  }
  console.log(`\x1b[32m✔ ${users.length} users created\x1b[0m`);

  console.log('\x1b[33m⏳ Seeding shipments…\x1b[0m');
  const shipments = [];
  
  // Standard shipments (happy paths and various statuses)
  for (let i = 0; i < 17; i++) {
    const status = STATUSES[i % STATUSES.length]!;
    const names = milestoneNames(status);
    let baseDate = faker.date.recent({ days: 30 });
    const milestones = names.map(name => {
      baseDate = new Date(baseDate.getTime() + faker.number.int({ min: 3600_000, max: 86400_000 }));
      return {
        name,
        timestamp: baseDate,
        description: faker.lorem.sentence(),
        userId: faker.helpers.arrayElement(users)._id,
      };
    });

    const shipment = await Shipment.create({
      trackingNumber: `NAV-${faker.string.alphanumeric({ length: 10, casing: 'upper' })}`,
      origin: faker.location.city() + ', ' + faker.location.country(),
      destination: faker.location.city() + ', ' + faker.location.country(),
      enterpriseId: enterprise._id,
      logisticsId: logistics._id,
      status,
      milestones,
      offChainMetadata: {
        weight: faker.number.float({ min: 0.5, max: 500, fractionDigits: 2 }),
        notes: faker.lorem.sentence(),
      },
    });
    shipments.push(shipment);
  }

  // Edge Case 1: Shipment stuck in transit for 5 days
  const stuckShipment = await Shipment.create({
    trackingNumber: `NAV-STUCK-${faker.string.alphanumeric({ length: 6, casing: 'upper' })}`,
    origin: faker.location.city() + ', ' + faker.location.country(),
    destination: faker.location.city() + ', ' + faker.location.country(),
    enterpriseId: enterprise._id,
    logisticsId: logistics._id,
    status: ShipmentStatus.IN_TRANSIT,
    milestones: [
      {
        name: 'Order Placed',
        timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
        description: 'Order placed',
        userId: faker.helpers.arrayElement(users)._id,
      },
      {
        name: 'Picked Up',
        timestamp: new Date(Date.now() - 4.5 * 24 * 60 * 60 * 1000), // 4.5 days ago
        description: 'Package picked up from warehouse',
        userId: faker.helpers.arrayElement(users)._id,
      },
      {
        name: 'In Transit',
        timestamp: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000), // 4 days ago
        description: 'Package in transit - STUCK HERE',
        userId: faker.helpers.arrayElement(users)._id,
      },
    ],
    offChainMetadata: {
      weight: faker.number.float({ min: 0.5, max: 500, fractionDigits: 2 }),
      notes: 'EDGE CASE: Shipment delayed - stuck in transit for 5 days',
      edgeCase: 'delayed_5_days',
    },
  });
  shipments.push(stuckShipment);

  // Edge Case 2: Shipment with multiple anomalies
  const anomalousShipment = await Shipment.create({
    trackingNumber: `NAV-ANOM-${faker.string.alphanumeric({ length: 6, casing: 'upper' })}`,
    origin: faker.location.city() + ', ' + faker.location.country(),
    destination: faker.location.city() + ', ' + faker.location.country(),
    enterpriseId: enterprise._id,
    logisticsId: logistics._id,
    status: ShipmentStatus.IN_TRANSIT,
    milestones: [
      {
        name: 'Order Placed',
        timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        description: 'Order placed',
        userId: faker.helpers.arrayElement(users)._id,
      },
      {
        name: 'Picked Up',
        timestamp: new Date(Date.now() - 1.5 * 24 * 60 * 60 * 1000),
        description: 'Package picked up',
        userId: faker.helpers.arrayElement(users)._id,
      },
      {
        name: 'In Transit',
        timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        description: 'In transit with anomalies detected',
        userId: faker.helpers.arrayElement(users)._id,
      },
    ],
    offChainMetadata: {
      weight: faker.number.float({ min: 0.5, max: 500, fractionDigits: 2 }),
      notes: 'EDGE CASE: Shipment with 3+ anomalies',
      edgeCase: 'multiple_anomalies',
    },
  });
  shipments.push(anomalousShipment);

  // Edge Case 3: Shipment with heavy pagination telemetry (100+ records)
  const heavyTelemetryShipment = await Shipment.create({
    trackingNumber: `NAV-HEAVY-${faker.string.alphanumeric({ length: 6, casing: 'upper' })}`,
    origin: faker.location.city() + ', ' + faker.location.country(),
    destination: faker.location.city() + ', ' + faker.location.country(),
    enterpriseId: enterprise._id,
    logisticsId: logistics._id,
    status: ShipmentStatus.IN_TRANSIT,
    milestones: [
      {
        name: 'Order Placed',
        timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        description: 'Order placed',
        userId: faker.helpers.arrayElement(users)._id,
      },
      {
        name: 'Picked Up',
        timestamp: new Date(Date.now() - 2.5 * 24 * 60 * 60 * 1000),
        description: 'Package picked up',
        userId: faker.helpers.arrayElement(users)._id,
      },
      {
        name: 'In Transit',
        timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        description: 'In transit with heavy telemetry',
        userId: faker.helpers.arrayElement(users)._id,
      },
    ],
    offChainMetadata: {
      weight: faker.number.float({ min: 0.5, max: 500, fractionDigits: 2 }),
      notes: 'EDGE CASE: Shipment with 100+ telemetry records for pagination testing',
      edgeCase: 'heavy_telemetry',
    },
  });
  shipments.push(heavyTelemetryShipment);

  console.log(`\x1b[32m✔ ${shipments.length} shipments created (including 3 edge cases)\x1b[0m`);

  console.log('\x1b[33m⏳ Seeding telemetry…\x1b[0m');
  const telemetryDocs = [];
  
  // Regular telemetry for standard shipments
  for (let i = 0; i < 100; i++) {
    telemetryDocs.push({
      shipmentId: faker.helpers.arrayElement(shipments.slice(0, 17))._id,
      temperature: faker.number.float({ min: -20, max: 45, fractionDigits: 1 }),
      humidity: faker.number.float({ min: 10, max: 99, fractionDigits: 1 }),
      latitude: faker.location.latitude(),
      longitude: faker.location.longitude(),
      batteryLevel: faker.number.int({ min: 0, max: 100 }),
      timestamp: faker.date.recent({ days: 14 }),
    });
  }

  // Heavy telemetry for edge case shipment (100+ records)
  for (let i = 0; i < 120; i++) {
    telemetryDocs.push({
      shipmentId: heavyTelemetryShipment._id,
      temperature: faker.number.float({ min: 15, max: 25, fractionDigits: 1 }),
      humidity: faker.number.float({ min: 40, max: 60, fractionDigits: 1 }),
      latitude: faker.location.latitude(),
      longitude: faker.location.longitude(),
      batteryLevel: faker.number.int({ min: 50, max: 100 }),
      timestamp: new Date(Date.now() - faker.number.int({ min: 0, max: 3 * 24 * 60 * 60 * 1000 })),
    });
  }

  // Anomalous telemetry for anomaly edge case (temperature and humidity spikes)
  for (let i = 0; i < 50; i++) {
    const isAnomaly = i % 5 === 0; // Every 5th record is anomalous
    telemetryDocs.push({
      shipmentId: anomalousShipment._id,
      temperature: isAnomaly ? faker.number.float({ min: 35, max: 50, fractionDigits: 1 }) : faker.number.float({ min: 15, max: 25, fractionDigits: 1 }),
      humidity: isAnomaly ? faker.number.float({ min: 85, max: 99, fractionDigits: 1 }) : faker.number.float({ min: 40, max: 60, fractionDigits: 1 }),
      latitude: faker.location.latitude(),
      longitude: faker.location.longitude(),
      batteryLevel: isAnomaly ? faker.number.int({ min: 5, max: 15 }) : faker.number.int({ min: 50, max: 100 }),
      timestamp: new Date(Date.now() - faker.number.int({ min: 0, max: 2 * 24 * 60 * 60 * 1000 })),
    });
  }

  // Stuck shipment telemetry (no movement)
  for (let i = 0; i < 30; i++) {
    telemetryDocs.push({
      shipmentId: stuckShipment._id,
      temperature: faker.number.float({ min: 18, max: 22, fractionDigits: 1 }),
      humidity: faker.number.float({ min: 45, max: 55, fractionDigits: 1 }),
      latitude: 40.7128, // Fixed location (New York)
      longitude: -74.006,
      batteryLevel: faker.number.int({ min: 30, max: 80 }),
      timestamp: new Date(Date.now() - faker.number.int({ min: 0, max: 5 * 24 * 60 * 60 * 1000 })),
    });
  }

  await TelemetryModel.insertMany(telemetryDocs);
  console.log(`\x1b[32m✔ ${telemetryDocs.length} telemetry points created\x1b[0m`);

  console.log('\x1b[33m⏳ Seeding payments…\x1b[0m');
  const paymentDocs = [];
  for (let i = 0; i < 15; i++) {
    const status = faker.helpers.arrayElement(PAYMENT_STATUSES);
    paymentDocs.push({
      shipmentId: faker.helpers.arrayElement(shipments)._id,
      amount: faker.number.float({ min: 50, max: 10000, fractionDigits: 2 }),
      currency: faker.helpers.arrayElement(CURRENCIES),
      status,
      method: faker.helpers.arrayElement(PAYMENT_METHODS),
      paidAt: status === 'completed' ? faker.date.recent({ days: 7 }) : undefined,
    });
  }
  await PaymentModel.insertMany(paymentDocs);
  console.log(`\x1b[32m✔ ${paymentDocs.length} payments created\x1b[0m`);

  console.log('\x1b[36m\n── Seed Summary ──────────────────\x1b[0m');
  console.log(`  Organizations : 2`);
  console.log(`  Users         : ${users.length}`);
  console.log(`  Shipments     : ${shipments.length} (including 3 edge cases)`);
  console.log(`    • Delayed 5 days (stuck in transit)`);
  console.log(`    • Multiple anomalies detected`);
  console.log(`    • Heavy telemetry (100+ records)`);
  console.log(`  Telemetry     : ${telemetryDocs.length}`);
  console.log(`  Payments      : ${paymentDocs.length}`);
  console.log('\x1b[36m──────────────────────────────────\x1b[0m\n');

  await disconnectMongo();
  console.log('\x1b[32m✔ Done — database seeded successfully\x1b[0m');
}

seed().catch(err => {
  console.error('\x1b[31m✖ Seed failed:\x1b[0m', err);
  process.exit(1);
});
