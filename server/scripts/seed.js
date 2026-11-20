// Idempotent dev seed: creates three test users (password: password123).
import bcrypt from 'bcryptjs';
import { pool } from '../src/db/pool.js';

const users = [
  { username: 'alice', displayName: 'Alice', phone: '+250780000001' },
  { username: 'bob', displayName: 'Bob', phone: '+250780000002' },
  { username: 'carol', displayName: 'Carol', phone: '+250780000003' },
];

const hash = await bcrypt.hash('password123', 12);
for (const u of users) {
  const { rowCount } = await pool.query(
    `INSERT INTO users (username, display_name, phone, password_hash)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (username) DO NOTHING`,
    [u.username, u.displayName, u.phone, hash],
  );
  console.log(`${rowCount ? 'created' : 'exists '} ${u.username}`);
}
await pool.end();
