// db/invitations.js
// Private beta invite gate. One invitation per email (re-invite = update the
// existing row, don't create a second one — enforced by the unique index).
const { pool } = require('./index');

async function getValidInvitation(email) {
  const cleanEmail = email.trim().toLowerCase();
  const res = await pool.query(
    `SELECT * FROM invitations
     WHERE LOWER(email) = $1
       AND status = 'pending'
       AND (expires_at IS NULL OR expires_at > NOW())
     LIMIT 1`,
    [cleanEmail]
  );
  return res.rows[0] || null;
}

async function acceptInvitation(email) {
  const cleanEmail = email.trim().toLowerCase();
  await pool.query(
    `UPDATE invitations SET status = 'accepted', accepted_at = NOW()
     WHERE LOWER(email) = $1 AND status = 'pending'`,
    [cleanEmail]
  );
}

// Founder-only: create or refresh an invitation for someone.
async function createInvitation(email, invitedByUserId = null, expiresInDays = 30) {
  const cleanEmail = email.trim().toLowerCase();
  const token = require('crypto').randomBytes(16).toString('hex');
  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  const res = await pool.query(
    `INSERT INTO invitations (email, status, invite_token, invited_by, expires_at)
     VALUES ($1, 'pending', $2, $3, $4)
     ON CONFLICT (LOWER(email)) DO UPDATE
       SET status = 'pending', invite_token = $2, expires_at = $4, accepted_at = NULL
     RETURNING *`,
    [cleanEmail, token, invitedByUserId, expiresAt]
  );
  return res.rows[0];
}

module.exports = { getValidInvitation, acceptInvitation, createInvitation };