const { pool } = require('./index');
let bcrypt;
try {
  bcrypt = require('bcrypt');
} catch (e) {
  bcrypt = require('bcryptjs');
}
const crypto = require('crypto');

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
    const res = await pool.query('SELECT id, email, name FROM users WHERE id = $1 LIMIT 1', [id]);
    return res.rows[0] || null;
  } catch (error) {
    console.error('[auth] getUserById error:', error.message);
    return null;
  }
}

async function findOrCreateUser(email, name) {
  const cleanEmail = email.trim().toLowerCase();
  // Try to find existing user
  const existing = await pool.query(
    'SELECT * FROM users WHERE LOWER(email) = $1 LIMIT 1',
    [cleanEmail]
  );
  if (existing.rows.length > 0) return existing.rows[0];

  // Create new user (magic-link users have no password)
  const res = await pool.query(
    `INSERT INTO users (email, name) VALUES ($1, $2) RETURNING *`,
    [cleanEmail, name || null]
  );
  return res.rows[0];
}

async function createUserWithPassword(email, name, passwordHash) {
  const cleanEmail = email.trim().toLowerCase();
  // Check if user already exists
  const existing = await pool.query(
    'SELECT * FROM users WHERE LOWER(email) = $1 LIMIT 1',
    [cleanEmail]
  );
  if (existing.rows.length > 0) {
    throw new Error('An account with this email already exists.');
  }
  const res = await pool.query(
    `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING *`,
    [cleanEmail, name || null, passwordHash]
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
  // Mark as used
  await pool.query(`UPDATE auth_tokens SET used_at = NOW() WHERE id = $1`, [row.id]);
  return row.user_id;
}

module.exports = {
  getUserByEmailAndPassword,
  getUserById,
  findOrCreateUser,
  createUserWithPassword,
  hashPassword,
  createToken,
  validateToken,
};
