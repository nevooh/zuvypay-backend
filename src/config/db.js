const { Pool } = require('pg');

// DATABASE_URL is used when it's set (Render/production, pointing at Supabase
// or wherever) — this needs ssl since hosted Postgres providers require it,
// which your local Postgres never did. Falls back to the old individual
// DB_* vars for local development, unchanged from before.
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    })
  : new Pool({
      user: process.env.DB_USER,
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      password: process.env.DB_PASSWORD,
      port: process.env.DB_PORT,
    });

// A quick check mechanism to make sure the database is alive
pool.on('connect', () => {
  console.log('Database connected successfully!');
});

// Catch any unexpected database errors gracefully so your server doesn't crash
pool.on('error', (err) => {
  console.error('Unexpected database error:', err);
  process.exit(-1);
});

module.exports = pool;