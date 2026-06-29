const { Client } = require('pg');
let bcrypt;
try {
  bcrypt = require('bcrypt');
} catch (e) {
  bcrypt = require('bcryptjs');
}

function getDbClient() {
  return new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

async function getUserByEmailAndPassword(email, password) {
  const client = getDbClient();
  try {
    await client.connect();
    const cleanEmail = email.trim().toLowerCase();
    const res = await client.query('SELECT * FROM users WHERE email = $1 LIMIT 1;', [cleanEmail]);
    if (res.rows.length === 0) return null;
    const user = res.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return null;
    return user;
  } catch (error) {
    console.error('Auth DB Error:', error);
    throw error;
  } finally {
    await client.end();
  }
}

async function getUserById(id) {
  const client = getDbClient();
  try {
    await client.connect();
    const res = await client.query('SELECT id, email, name FROM users WHERE id = $1 LIMIT 1;', [id]);
    return res.rows[0] || null;
  } catch (error) {
    return null;
  } finally {
    await client.end();
  }
}

module.exports = {
  getUserByEmailAndPassword,
  getUserById,
  findOrCreateUser: async () => { return null; }
};