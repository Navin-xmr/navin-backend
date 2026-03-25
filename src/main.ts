import './loadEnv.js';

import { createServer } from 'http';
import { buildApp } from './app.js';
import { config } from './config/index.js';
import { connectMongo } from './infra/mongo/connection.js';
import { initSocketIO } from './infra/socket/io.js';

async function main() {
  await connectMongo(config.mongoUri);

  const app = buildApp();
  const httpServer = createServer(app);
  initSocketIO(httpServer);

  httpServer.listen(config.port, () => {
    console.log(`Listening on :${config.port}`);
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
