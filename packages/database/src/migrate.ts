import { config as loadDotenv } from 'dotenv';
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';

// Load .env from monorepo root (dist/ → packages/database → packages → root)
loadDotenv({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

const DATABASE_URL = process.env['DATABASE_URL'];
if (!DATABASE_URL) {
  throw new Error('Missing required environment variable: DATABASE_URL');
}

async function migrate(): Promise<void> {
  const pool = new Pool({ connectionString: DATABASE_URL });

  try {
    // Ensure the migrations tracking table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id         SERIAL      PRIMARY KEY,
        filename   TEXT        NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const migrationsDir = path.join(__dirname, '..', 'migrations');
    const files = fs
      .readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort(); // lexicographic order ensures 001, 002, ...

    for (const file of files) {
      const result = await pool.query(
        'SELECT 1 FROM _migrations WHERE filename = $1',
        [file],
      );
      if ((result.rowCount ?? 0) > 0) {
        console.log(`[migrate] Already applied: ${file}`);
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await pool.query('BEGIN');
      try {
        await pool.query(sql);
        await pool.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
        await pool.query('COMMIT');
        console.log(`[migrate] Applied: ${file}`);
      } catch (err) {
        await pool.query('ROLLBACK');
        throw err;
      }
    }

    console.log('[migrate] All migrations applied');
  } finally {
    await pool.end();
  }
}

migrate().catch(err => {
  console.error('[migrate] Fatal:', err);
  process.exit(1);
});
