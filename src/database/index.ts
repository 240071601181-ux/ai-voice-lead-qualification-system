import { Pool } from 'pg';
// Central env bootstrap: .env is loaded before DATABASE_URL is read.
import '../config/env';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not defined in environment variables');
}

export const pool = new Pool({
  connectionString,
});

export default pool;
