/**
 * Migration: shipment-delivery-indexes (#1043)
 *
 * - `shipmentdeliveries`: unique `chainShipmentId` (one delivery record per on-chain
 *   shipment — makes event replays converge), plus lookup indexes.
 * - `shipments`: sparse unique `chainShipmentId`, used to resolve delivery events to a shipment.
 *
 * No data backfill is required: both collections/fields are new and optional.
 */

export async function up(db) {
  const deliveries = db.collection('shipmentdeliveries');
  await deliveries.createIndex({ chainShipmentId: 1 }, { unique: true, name: 'chainShipmentId_1' });
  await deliveries.createIndex({ shipmentId: 1 }, { sparse: true, name: 'shipmentId_1' });
  await deliveries.createIndex(
    { carrier: 1, classification: 1 },
    { sparse: true, name: 'carrier_1_classification_1' }
  );
  await db
    .collection('shipments')
    .createIndex({ chainShipmentId: 1 }, { unique: true, sparse: true, name: 'chainShipmentId_1' });
}

export async function down(db) {
  const deliveries = db.collection('shipmentdeliveries');
  await deliveries.dropIndex('chainShipmentId_1');
  await deliveries.dropIndex('shipmentId_1');
  await deliveries.dropIndex('carrier_1_classification_1');
  await db.collection('shipments').dropIndex('chainShipmentId_1');
}
