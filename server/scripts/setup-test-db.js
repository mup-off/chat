// Creates the test database (if missing) and runs all migrations on it.
import pg from 'pg';
import { runner } from 'node-pg-migrate';

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error('TEST_DATABASE_URL is not set (see .env.example)');

const dbName = new URL(testUrl).pathname.slice(1);
if (!/^[a-z0-9_]+$/.test(dbName)) throw new Error(`Unexpected test DB name: ${dbName}`);

const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
await admin.connect();
const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
if (rowCount === 0) {
  await admin.query(`CREATE DATABASE ${dbName}`);
  console.log(`Created database ${dbName}`);
}
await admin.end();

await runner({
  databaseUrl: testUrl,
  dir: 'migrations',
  direction: 'up',
  migrationsTable: 'pgmigrations',
  log: () => {},
});
console.log(`Test database ${dbName} is migrated`);
