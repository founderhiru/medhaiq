// Database connection pool — single instance, shared across all db/ modules.
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

// Neon closes idle connections (auto-suspend). Without this listener the pooled
// client emits an unhandled 'error' event, which Node throws on and crashes the
// whole process. Log it and keep serving; the pool reconnects on the next query.
pool.on('error', (err) => {
  console.error('[pg pool] idle client error (non-fatal):', err && err.message);
});

module.exports = { pool };