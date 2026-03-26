import '../loadEnv.js';
import mongoose from 'mongoose';
import { generateApiKey } from '../modules/auth/apiKey.service.js';
import { config } from '../config/index.js';

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error('Usage: npm run generate-api-key <name> <organizationId> [shipmentId]');
    console.error('Example: npm run generate-api-key "IoT Sensor 1" 507f1f77bcf86cd799439011');
    process.exit(1);
  }

  const [name, organizationId, shipmentId] = args;

  try {
    await mongoose.connect(config.mongoUri);
    console.log('Connected to MongoDB');

    const result = await generateApiKey({
      name,
      organizationId,
      shipmentId,
    });

    console.log('\n✅ API Key Generated Successfully!\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('⚠️  IMPORTANT: Save this API key securely - it will not be shown again!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log(`API Key:        ${result.apiKey}`);
    console.log(`ID:             ${result.id}`);
    console.log(`Name:           ${result.name}`);
    console.log(`Organization:   ${result.organizationId}`);
    if (result.shipmentId) {
      console.log(`Shipment:       ${result.shipmentId}`);
    }
    console.log(`Created:        ${result.createdAt.toISOString()}`);
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('Usage: Include this header in your IoT webhook requests:');
    console.log(`x-api-key: ${result.apiKey}\n`);

  } catch (error) {
    console.error('Error generating API key:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

main();
