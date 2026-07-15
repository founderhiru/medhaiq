// db/founder-waitlist.js
// Founder Dashboard — pending beta requests. A "pending request" is a
// waitlist signup whose email has never been invited (no matching row in
// `invitations`, case-insensitive). Approving one just creates an
// invitation for that email — its existence IS the "handled" marker, so
// no new column/table is needed to track review status.
const { pool } = require('./index');

async function getPendingWaitlistEntries({ limit = 10, offset = 0 } = {}) {
  const res = await pool.query(
    `SELECT w.id, w.name, w.email, w.city, w.user_type, w.plan_interest, w.created_at
     FROM waitlist w
     WHERE NOT EXISTS (
       SELECT 1 FROM invitations i WHERE LOWER(i.email) = LOWER(w.email)
     )
     ORDER BY w.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return res.rows;
}

async function getPendingWaitlistCount() {
  const res = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM waitlist w
     WHERE NOT EXISTS (
       SELECT 1 FROM invitations i WHERE LOWER(i.email) = LOWER(w.email)
     )`
  );
  return res.rows[0].count;
}

module.exports = { getPendingWaitlistEntries, getPendingWaitlistCount };
