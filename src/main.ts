import './loadEnv.js';

import { buildApp } from './app.js';
import { config } from './config/index.js';
import { connectMongo } from './infra/mongo/connection.js';

async function main() {
  await connectMongo(config.mongoUri);

  const app = buildApp();
  app.listen(config.port, () => {
    console.log(`Listening on :${config.port}`);
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
