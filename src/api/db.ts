import pg from 'pg';
import type { Pool } from 'pg';

const { Pool: PgPool } = pg;

export function createPool(databaseUrl: string): Pool {
  const pool = new PgPool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  pool.on('error', (error) => {
    console.error('[db] idle client error:', error.message);
  });
  return pool;
}
