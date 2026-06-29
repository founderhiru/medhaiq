// Standalone migration runner — used by `npm run migrate` (Render build step)
// Also called from server.js at startup as a fallback.
require('dotenv').config({ path: '.env' });

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
