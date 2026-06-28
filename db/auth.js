// Auth routes — magic link email login, no passwords.
const express = require('express');
const passport = require('passport');
const { findOrCreateUser, getUserById, getUserByEmailAndPassword, createUserWithPassword, hashPassword, createToken, validateToken } = require('../db/auth');
const { sendMagicLinkEmail } = require('../services/email');
const router = express.Router();

// GET /auth/google — initiate Google OAuth
router.get('/google', (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.redirect('/auth/login?error=google-not-configured');
  }
  passport.authenticate('google', { scope: ['email', 'profile'] })(req, res, next);
});

// GET /auth/google/callback — Google OAuth callback
router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/auth/login?error=google-auth-failed' }),
  (req, res) => {
    res.cookie('user_id', req.user.id, {
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
    });
    res.redirect('/dashboard/history');
  }
);

// POST /auth/login — send magic link
router.post('/login', async (req, res) => {
  const { email, name } = req.body;
  const trimmed = (email || '').trim();
  if (!trimmed || !/^[^\n\r@]+@[^\n\r@]+\.[^\n\r@]+$/.test(trimmed)) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  try {
    const user = await findOrCreateUser(email.trim().toLowerCase(), name?.trim() || null);
    const token = await createToken(user.id, 1);

    const magicUrl = `${process.env.APP_URL || 'https://medhaiq.polsia.app'}/auth/verify?token=${token}`;

    await sendMagicLinkEmail(email.trim().toLowerCase(), magicUrl);

    return res.json({ success: true, message: 'Magic link sent. Check your email.' });
  } catch (err) {
    console.error('[auth] login error:', err);
    return res.status(500).json({ error: 'Failed to send magic link' });
  }
});

// POST /auth/password-login — login with email + password
router.post('/password-login', async (req, res) => {
  const { email, password } = req.body;
  const trimmed = (email || '').trim();
  if (!trimmed || !/^[^\n\r@]+@[^\n\r@]+\.[^\n\r@]+$/.test(trimmed)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (!password || password.length < 8) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  try {
    const user = await getUserByEmailAndPassword(email.trim().toLowerCase(), password);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    res.cookie('user_id', user.id, {
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
    });

    return res.json({ success: true });
  } catch (err) {
    console.error('[auth] password-login error:', err);
    return res.status(500).json({ error: 'An error occurred. Please try again.' });
  }
});

// POST /auth/signup — create account with password
router.post('/signup', async (req, res) => {
  const { email, password, name } = req.body;
  const trimmed = (email || '').trim();
  if (!trimmed || !/^[^\n\r@]+@[^\n\r@]+\.[^\n\r@]+$/.test(trimmed)) {
    return res.status(400).json({ error: 'Valid email required' });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const hash = await hashPassword(password);
    const user = await createUserWithPassword(email.trim().toLowerCase(), name?.trim() || null, hash);

    res.cookie('user_id', user.id, {
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
    });

    return res.json({ success: true });
  } catch (err) {
    console.error('[auth] signup error:', err);
    return res.status(500).json({ error: 'Failed to create account' });
  }
});

// GET /auth/verify?token=xxx — consume token, set session
router.get('/verify', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.redirect('/?error=no-token');

  try {
    const userId = await validateToken(token);
    if (!userId) return res.redirect('/?error=invalid-token');

    const user = await getUserById(userId);
    if (!user) return res.redirect('/?error=user-not-found');

    res.cookie('user_id', userId, {
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
    });

    return res.redirect('/interview');
  } catch (err) {
    console.error('[auth] verify error:', err);
    return res.redirect('/?error=verify-failed');
  }
});

// GET /auth/me — get current user from cookie
router.get('/me', async (req, res) => {
  const userId = req.cookies?.user_id;
  if (!userId) return res.json({ user: null });

  const user = await getUserById(userId);
  if (!user) return res.json({ user: null });
  return res.json({ user: { id: user.id, email: user.email, name: user.name } });
});

// GET /auth/logout — clear cookie
router.get('/logout', (req, res) => {
  res.clearCookie('user_id');
  return res.json({ success: true });
});

module.exports = router;