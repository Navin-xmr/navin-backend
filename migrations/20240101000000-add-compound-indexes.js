export async function up(db) {
  const shipments = db.collection('shipments');
  await shipments.createIndex({ status: 1, createdAt: -1 });
  await shipments.createIndex({ enterpriseId: 1, createdAt: -1 });
  await shipments.createIndex({ logisticsId: 1, createdAt: -1 });
  await shipments.createIndex({ createdAt: -1, _id: -1 });

  const anomalies = db.collection('anomalies');
  await anomalies.createIndex({ shipmentId: 1, timestamp: -1, _id: -1 });
  await anomalies.createIndex({ resolved: 1, timestamp: -1, _id: -1 });
  await anomalies.createIndex({ severity: 1, timestamp: -1, _id: -1 });
  await anomalies.createIndex({ severity: 1, shipmentId: 1, timestamp: -1, _id: -1 });

  const telemetries = db.collection('telemetries');
  await telemetries.createIndex({ shipmentId: 1, timestamp: -1 });
  await telemetries.createIndex({ anchorStatus: 1 });

  const apikeys = db.collection('apikeys');
  await apikeys.createIndex({ keyHash: 1 });
  await apikeys.createIndex({ organizationId: 1 });
  await apikeys.createIndex({ shipmentId: 1 });
}

export async function down(db) {
  const shipments = db.collection('shipments');
  await shipments.dropIndex({ status: 1, createdAt: -1 });
  await shipments.dropIndex({ enterpriseId: 1, createdAt: -1 });
  await shipments.dropIndex({ logisticsId: 1, createdAt: -1 });
  await shipments.dropIndex({ createdAt: -1, _id: -1 });

  const anomalies = db.collection('anomalies');
  await anomalies.dropIndex({ shipmentId: 1, timestamp: -1, _id: -1 });
  await anomalies.dropIndex({ resolved: 1, timestamp: -1, _id: -1 });
  await anomalies.dropIndex({ severity: 1, timestamp: -1, _id: -1 });
  await anomalies.dropIndex({ severity: 1, shipmentId: 1, timestamp: -1, _id: -1 });

  const telemetries = db.collection('telemetries');
  await telemetries.dropIndex({ shipmentId: 1, timestamp: -1 });
  await telemetries.dropIndex({ anchorStatus: 1 });

  const apikeys = db.collection('apikeys');
  await apikeys.dropIndex({ keyHash: 1 });
  await apikeys.dropIndex({ organizationId: 1 });
  await apikeys.dropIndex({ shipmentId: 1 });
}
