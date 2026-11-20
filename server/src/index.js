import { config } from './config.js';
import { pool } from './db/pool.js';
import { createServer } from './app.js';

const { server, io } = createServer();

server.listen(config.port, () => {
  console.log(`Server listening on http://localhost:${config.port}`);
});

async function shutdown() {
  io.close();
  server.close();
  await pool.end();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
