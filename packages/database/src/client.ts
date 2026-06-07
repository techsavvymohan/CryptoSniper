import { Pool, PoolClient } from 'pg';

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const DATABASE_URL = process.env['DATABASE_URL'];
    if (!DATABASE_URL) {
      throw new Error('Missing required environment variable: DATABASE_URL');
    }
    pool = new Pool({
      connectionString: DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 2_000,
    });
    pool.on('error', (err) => {
      console.error('[DB] Unexpected pool error:', err.message);
    });
  }
  return pool;
}

export async function connect(): Promise<void> {
  const client = await getPool().connect();
  client.release();
  console.log('[DB] Connection pool ready');
}

export async function disconnect(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('[DB] Connection pool closed');
  }
}

export async function healthCheck(): Promise<boolean> {
  try {
    const result = await getPool().query<{ now: Date }>('SELECT NOW()');
    return result.rows.length > 0;
  } catch {
    return false;
  }
}

export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export const db = {
  get pool() {
    return getPool();
  },
};
