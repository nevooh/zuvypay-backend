const { Pool } = require('pg');


// Create a connection pool using variables from your .env file
const pool = new Pool({
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
