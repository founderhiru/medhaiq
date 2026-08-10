const { pool } = require('./index');
let bcrypt;
try {
  bcrypt = require('bcrypt');
} catch (e) {
  bcrypt = require('bcryptjs');
}
const crypto = require('crypto');

async function getUserByEmail(email) {
  const cleanEmail = email.trim().toLowerCase();
  const res = await pool.query('SELECT * FROM users WHERE LOWER(email) = $1 LIMIT 1', [cleanEmail]);
  return res.rows[0] || null;
}

async function getUserByEmailAndPassword(email, password) {
  const cleanEmail = email.trim().toLowerCase();
  const res = await pool.query('SELECT * FROM users WHERE LOWER(email) = $1 LIMIT 1', [cleanEmail]);
  if (res.rows.length === 0) return null;
  const user = res.rows[0];
  if (!user.password_hash) return null;
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return null;
  return user;
}

async function getUserById(id) {
  try {
    const res = await pool.query('SELECT id, email, name, subscription_plan, subscription_status, created_at FROM users WHERE id = $1 LIMIT 1', [id]);
    return res.rows[0] || null;
  } catch (error) {
    console.error('[auth] getUserById error:', error.message);
    return null;
  }
}

async function findOrCreateUser(email, name) {
  const cleanEmail = email.trim().toLowerCase();
  const existing = await pool.query(
    'SELECT * FROM users WHERE LOWER(email) = $1 LIMIT 1',
    [cleanEmail]
  );
  if (existing.rows.length > 0) return existing.rows[0];

  // email_verified: explicitly false here — the users.email_verified
  // column DEFAULTs to true (migration 019, back-fill precedent for rows
  // that predate the concept), but a brand-new magic-link account has NOT
  // proven email ownership yet at row-creation time. It flips to true in
  // routes/auth.js's /verify handler, the moment the emailed token is
  // actually consumed — that's also the trigger point for the one-time
  // Welcome Offer grant (services/free-offer-guardrail.js). An EXISTING
  // user hitting /login again is unaffected: this INSERT only runs on
  // first creation, never on a later login.
  const res = await pool.query(
    `INSERT INTO users (email, name, email_verified) VALUES ($1, $2, false) RETURNING *`,
    [cleanEmail, name || null]
  );
  return res.rows[0];
}

async function createUserWithPassword(email, name, passwordHash) {
  const cleanEmail = email.trim().toLowerCase();
  const existing = await pool.query(
    'SELECT * FROM users WHERE LOWER(email) = $1 LIMIT 1',
    [cleanEmail]
  );
  if (existing.rows.length > 0) {
    throw new Error('An account with this email already exists.');
  }
  // Same email_verified=false rationale as findOrCreateUser above — the
  // password path previously had no verification step at all (see
  // routes/auth.js's /signup handler, which now also sends a
  // verification email). Login stays instant either way (the cookie is
  // still set at signup); only the Welcome Offer credit waits on
  // verification.
  const res = await pool.query(
    `INSERT INTO users (email, name, password_hash, email_verified) VALUES ($1, $2, $3, false) RETURNING *`,
    [cleanEmail, name || null, passwordHash]
  );
  return res.rows[0];
}

async function findOrCreateUserFromGoogle(profile) {
  const email = profile?.emails?.[0]?.value;
  if (!email) throw new Error('Google profile did not return an email address');
  const cleanEmail = email.trim().toLowerCase();
  const name = profile?.displayName || null;

  const existing = await pool.query(
    'SELECT * FROM users WHERE LOWER(email) = $1 LIMIT 1',
    [cleanEmail]
  );
  if (existing.rows.length > 0) return existing.rows[0];

  // email_verified=false at creation, same as the other two paths —
  // Google HAS already confirmed this address, but routes/auth.js's
  // callback handler calls markEmailVerified() right after this returns,
  // the same call every path uses. Keeping one single "first time
  // verified" signal (markEmailVerified's return value) across all three
  // auth methods, instead of three different ways of deciding it, is
  // what lets the Welcome Offer grant be wired in exactly one place per
  // route rather than three subtly different ones.
  const res = await pool.query(
    `INSERT INTO users (email, name, email_verified) VALUES ($1, $2, false) RETURNING *`,
    [cleanEmail, name]
  );
  return res.rows[0];
}

async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

async function createToken(userId, expiresInHours = 1) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO auth_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
    [userId, token, expiresAt]
  );
  return token;
}

async function validateToken(token) {
  const res = await pool.query(
    `SELECT * FROM auth_tokens WHERE token = $1 AND expires_at > NOW() AND used_at IS NULL LIMIT 1`,
    [token]
  );
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  await pool.query(`UPDATE auth_tokens SET used_at = NOW() WHERE id = $1`, [row.id]);
  return row.user_id;
}

// Account Settings' Profile tab needs to show a sign-in method, but
// getUserById() deliberately never selects password_hash (used broadly
// elsewhere; no reason to expose that column more widely than necessary).
// This is a separate, narrowly-scoped query that returns only a boolean —
// never the hash itself.
async function hasPasswordSet(userId) {
  const result = await pool.query(
    'SELECT password_hash IS NOT NULL AS has_password FROM users WHERE id = $1',
    [userId]
  );
  return !!(result.rows[0] && result.rows[0].has_password);
}

// Idempotent by construction (WHERE email_verified = false — a second
// call on an already-verified user is a harmless no-op UPDATE touching
// zero rows). Returns true only the FIRST time a given user is marked
// verified, which routes/auth.js uses to decide whether this is the
// moment to attempt the one-time Welcome Offer grant.
async function markEmailVerified(userId) {
  const res = await pool.query(
    `UPDATE users SET email_verified = true WHERE id = $1 AND email_verified = false RETURNING id`,
    [userId]
  );
  return res.rows.length > 0;
}

async function updateUserName(userId, name) {
  const cleanName = (name || '').trim();
  if (!cleanName) throw new Error('Name cannot be empty');
  const result = await pool.query(
    `UPDATE users SET name = $2, updated_at = NOW() WHERE id = $1 RETURNING id, name, email`,
    [userId, cleanName]
  );
  return result.rows[0] || null;
}

module.exports = {
  getUserByEmail,
  getUserByEmailAndPassword,
  getUserById,
  findOrCreateUser,
  createUserWithPassword,
  findOrCreateUserFromGoogle,
  hashPassword,
  createToken,
  validateToken,
  updateUserName,
  hasPasswordSet,
  markEmailVerified,
};