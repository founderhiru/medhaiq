// Waitlist DB access — do not use pool.query outside this module.
const { pool } = require('./index');

async function createWaitlistEntry({ name, email, phone, city, userType, planInterest, ipAddress, userAgent }) {
  const result = await pool.query(
    `INSERT INTO waitlist (name, email, phone, city, user_type, plan_interest, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, created_at`,
    [name, email, phone || null, city || null, userType, planInterest || null, ipAddress || null, userAgent || null]
  );
  return result.rows[0];
}

async function getWaitlistCount() {
  const result = await pool.query('SELECT COUNT(*) as count FROM waitlist');
  return parseInt(result.rows[0].count, 10);
}

async function getWaitlistEntries({ limit = 1000, offset = 0 } = {}) {
  const result = await pool.query(
    `SELECT id, name, email, phone, city, user_type, created_at
     FROM waitlist
     ORDER BY created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return result.rows;
}

async function getWaitlistCSV() {
  const result = await pool.query(
    `SELECT name, email, phone, city, user_type, created_at
     FROM waitlist
     ORDER BY created_at DESC`
  );
  return result.rows;
}

module.exports = { createWaitlistEntry, getWaitlistCount, getWaitlistEntries, getWaitlistCSV };