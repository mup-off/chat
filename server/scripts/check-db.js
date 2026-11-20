import { pool } from '../src/db/pool.js';

const { rows } = await pool.query(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name <> 'pgmigrations'
  ORDER BY table_name`);
console.log('Tables:', rows.map((r) => r.table_name).join(', '));

const idx = await pool.query(`
  SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`);
console.log('Indexes:', idx.rows.map((r) => r.indexname).join(', '));
await pool.end();
