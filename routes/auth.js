// Auth routes — magic link email login, no passwords.
const express = require('express');
const passport = require('passport');
const {
  findOrCreateUser, getUserById, getUserByEmail, getUserByEmailAndPassword,
  createUserWithPassword, hashPassword, createToken, validateToken,
} = require('../db/auth');
const { getValidInvitation, acceptInvitation } = require('../db/invitations');
const { ensureUserBootstrap } = require('../db/profile-bootstrap');
const { logUserActivity } = require('../services/activity-logger');
const { sendMagicLinkEmail } = require('../services/email');
const router = express.Router();

// Validates a "next" redirect target so it can only ever point somewhere
// internal — never an external site or protocol-relative URL (open-redirect
// guard). Used everywhere a "return to where the user was headed" value is
// read from a query string or form body.
function safeReturnTo(value) {
  if (typeof value !== 'string' || !value) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  return value;
}

// GET /auth/google — initiate Google OAuth
router.get('/google', (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.redirect('/auth/login?error=google-not-configured');
  }
  const returnTo = safeReturnTo(req.query.next);
  passport.authenticate('google', { scope: ['email', 'profile'], state: returnTo || '' })(req, res, next);
});

// GET /auth/google/callback — Google OAuth callback
router.get('/google/callback',
  (req, res, next) => {
    passport.authenticate('google', (err, user, info) => {
      if (err) return res.redirect('/auth/login?error=google-auth-failed');
      if (!user) return res.redirect('/auth/login?error=no-invite');
      req.user = user;
      next();
    })(req, res, next);
  },
  (req, res) => {
    res.cookie('user_id', req.user.id, {
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
    });
    logUserActivity({ userId: req.user.id, action: 'login_google', page: '/auth/google/callback', req });
    const returnTo = safeReturnTo(req.query.state);
    res.redirect(returnTo || '/dashboard/history');
  }
);

// POST /auth/login — send magic link
router.post('/login', async (req, res) => {
  const { email, name, next: nextParam } = req.body;
  const returnTo = safeReturnTo(nextParam);
  const trimmed = (email || '').trim();
  if (!trimmed || !/^[^\n\r@]+@[^\n\r@]+\.[^\n\r@]+$/.test(trimmed)) {
    return res.status(400).json({ error: 'Valid email required' });
  }
  const cleanEmail = trimmed.toLowerCase();

  try {
    const existingUser = await getUserByEmail(cleanEmail);
    const isNewUser = !existingUser;

    if (isNewUser) {
      const invite = await getValidInvitation(cleanEmail);
      if (!invite) {
        return res.status(403).json({ error: 'This email does not have an active private beta invitation.' });
      }
    }

    const user = await findOrCreateUser(cleanEmail, name?.trim() || null);

    if (isNewUser) {
      await acceptInvitation(cleanEmail);
      await ensureUserBootstrap(user.id);
    }

    const token = await createToken(user.id, 1);
    const magicUrl = `${process.env.APP_URL || 'https://www.medhaiq.ai'}/auth/verify?token=${token}${returnTo ? '&next=' + encodeURIComponent(returnTo) : ''}`;
    await sendMagicLinkEmail(cleanEmail, magicUrl);

    logUserActivity({ userId: user.id, action: isNewUser ? 'signup_magic_link' : 'login_magic_link_requested', page: '/auth/login', req });

    return res.json({ success: true, message: 'Magic link sent. Check your email.' });
  } catch (err) {
    console.error('[auth] login error:', err);
    return res.status(500).json({ error: 'Failed to send magic link' });
  }
});

// POST /auth/password-login — login with email + password
router.post('/password-login', async (req, res) => {
  const { email, password, next: nextParam } = req.body;
  const returnTo = safeReturnTo(nextParam);
  const trimmed = (email || '').trim();
  if (!trimmed || !/^[^\n\r@]+@[^\n\r@]+\.[^\n\r@]+$/.test(trimmed)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (!password || password.length < 8) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  try {
    const user = await getUserByEmailAndPassword(trimmed.toLowerCase(), password);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    res.cookie('user_id', user.id, {
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
    });

    logUserActivity({ userId: user.id, action: 'login_password', page: '/auth/password-login', req });

    return res.json({ success: true, next: returnTo || null });
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
  const cleanEmail = trimmed.toLowerCase();

  try {
    const invite = await getValidInvitation(cleanEmail);
    if (!invite) {
      return res.status(403).json({ error: 'This email does not have an active private beta invitation.' });
    }

    const hash = await hashPassword(password);
    const user = await createUserWithPassword(cleanEmail, name?.trim() || null, hash);

    await acceptInvitation(cleanEmail);
    await ensureUserBootstrap(user.id);

    res.cookie('user_id', user.id, {
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
    });

    logUserActivity({ userId: user.id, action: 'signup_password', page: '/auth/signup', req });

    return res.json({ success: true });
  } catch (err) {
    console.error('[auth] signup error:', err);
    return res.status(500).json({ error: 'Failed to create account' });
  }
});

// GET /auth/verify?token=xxx — consume token, set session
router.get('/verify', async (req, res) => {
  const { token } = req.query;
  const returnTo = safeReturnTo(req.query.next);
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

    logUserActivity({ userId, action: 'login_magic_link_verified', page: '/auth/verify', req });

    return res.redirect(returnTo || '/dashboard/history');
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

// GET /auth/logout — clear cookie, then send the browser somewhere real.
// This is a plain <a href="/auth/logout"> link (views/partials/
// workspace-shell-top.ejs), not a fetch() call — a full browser navigation
// needs a redirect response, not a JSON body, or the person just sees raw
// JSON on screen instead of landing anywhere.
router.get('/logout', (req, res) => {
  res.clearCookie('user_id');
  return res.redirect('/');
});

module.exports = router;