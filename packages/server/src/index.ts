import { loadConfig } from './config.js';
import { PostgresDatabase } from './db.js';
import { startAuthServer } from './server.js';

export { createAuthApp, startAuthServer } from './server.js';
export { PostgresDatabase } from './db.js';
export type * from './types.js';

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  const db = new PostgresDatabase(config.databaseUrl);
  const server = startAuthServer(config, db);
  console.log(`Nex-auth listening on port ${config.port}`);
  const shutdown = async () => {
    server.close();
    await db.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
