// Standalone migration runner — used by `npm run migrate` (Render build step)
// Also called from server.js at startup as a fallback.
// dotenv is a devDependency for local `.env` files only — Render (and any
// other host) injects real env vars directly, so this must never be able
// to crash a production run just because the package isn't installed.
try {
  require('dotenv').config({ path: '.env' });
} catch (e) {
  // no-op: expected in production, where env vars come from the platform
}

if (!process.env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL not set');
  process.exit(1);
}

const { runMigrations } = require('./db/migrate');

runMigrations()
  .then(() => {
    console.log('Migration script complete.');
    process.exit(0);
  })
  .catch(err => {
    console.error('Migration script failed:', err.message);
    process.exit(1);
  });
