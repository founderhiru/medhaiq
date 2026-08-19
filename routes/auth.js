// Auth routes — magic link email login, no passwords.
const express = require('express');
const passport = require('passport');
const {
  findOrCreateUser, getUserById, getUserByEmail, getUserByEmailAndPassword,
  createUserWithPassword, hashPassword, createToken, validateToken,
  markEmailVerified,
} = require('../db/auth');
const { acceptInvitation } = require('../db/invitations');
const { ensureUserBootstrap } = require('../db/profile-bootstrap');
const { logUserActivity } = require('../services/activity-logger');
const { sendMagicLinkEmail, sendVerificationEmail, sendFounderSignupNotification } = require('../services/email');
// Anti-Abuse & Free-Offer Guardrail
const { grantWelcomeOfferIfEligible } = require('../services/free-offer-guardrail');
const { authLimiter } = require('../middleware/rate-limit');
const router = express.Router();

// Shared by /auth/verify and the Google callback below — the ONE place
// the one-time Welcome Offer grant is triggered from. Safe to call after
// any successful auth event; markEmailVerified()'s return value (true
// only on the actual false->true flip) keeps this a no-op DB hit for
// every subsequent login by an already-verified user, not a query on
// every single login forever.
async function handleFirstVerification(req, userId) {
  try {
    const firstTimeVerified = await markEmailVerified(userId);
    if (!firstTimeVerified) return;
    const result = await grantWelcomeOfferIfEligible({
      userId,
      deviceHash: req.deviceHash,
      ipHash: req.ipHash,
    });
    logUserActivity({
      userId,
      action: result.granted ? 'welcome_offer_granted' : 'welcome_offer_restricted',
      page: '/auth/verify',
      req,
    });
  } catch (err) {
    // Never let a guardrail failure block login — the account and
    // session are already valid at this point regardless of whether the
    // promotional credit lands. Worst case: a legitimate user needs a
    // manual grant from the Founder Dashboard, which is a much smaller
    // problem than locking someone out of their own account.
    console.error('[auth] welcome-offer grant error:', err);
  }
}

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
router.get('/google', authLimiter, (req, res, next) => {
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
  async (req, res) => {
    res.cookie('user_id', req.user.id, {
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
    });
    logUserActivity({ userId: req.user.id, action: 'login_google', page: '/auth/google/callback', req });
    // Founder notification — genuinely new accounts only (isNewUser is
    // passed through from config/passport.js's verify callback above).
    // Fire-and-forget: sendFounderSignupNotification() attaches its own
    // .catch() internally, so a delivery failure here can never affect
    // this login/signup response.
    if (req.user.isNewUser) {
      sendFounderSignupNotification({ name: req.user.name, email: req.user.email, signupMethod: 'Google OAuth' });
    }
    // Google has already confirmed this address — this call flips
    // email_verified and, on a first-time flip, attempts the Welcome
    // Offer grant. See handleFirstVerification's own comment.
    await handleFirstVerification(req, req.user.id);
    const returnTo = safeReturnTo(req.query.state);
    res.redirect(returnTo || '/dashboard/history');
  }
);

// POST /auth/login — send magic link
router.post('/login', authLimiter, async (req, res) => {
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

    const user = await findOrCreateUser(cleanEmail, name?.trim() || null);

    if (isNewUser) {
      await acceptInvitation(cleanEmail);
      await ensureUserBootstrap(user.id);
      // Founder notification — new account only, never on a returning
      // user's magic-link request. Fire-and-forget (see comment on the
      // Google callback above).
      sendFounderSignupNotification({ name: user.name, email: user.email, signupMethod: 'Magic link' });
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
router.post('/password-login', authLimiter, async (req, res) => {
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
router.post('/signup', authLimiter, async (req, res) => {
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
    const hash = await hashPassword(password);
    const user = await createUserWithPassword(cleanEmail, name?.trim() || null, hash);

    await acceptInvitation(cleanEmail);
    await ensureUserBootstrap(user.id);
    // Founder notification — createUserWithPassword() above throws if the
    // email already exists, so reaching this line means the account is
    // guaranteed new. Fire-and-forget (see comment on the Google callback
    // above).
    sendFounderSignupNotification({ name: user.name, email: user.email, signupMethod: 'Password' });

    res.cookie('user_id', user.id, {
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
    });

    logUserActivity({ userId: user.id, action: 'signup_password', page: '/auth/signup', req });

    // Unchanged: the user is logged in immediately (cookie set above),
    // same as before. What's new: this account is NOT yet email_verified
    // (db/auth.js::createUserWithPassword), so it has zero Welcome Offer
    // minutes until they verify — the password path previously had no
    // verification step at all, which meant instant, unlimited-by-
    // account-creation Explorer access. This sends the same magic-link
    // email/token machinery /auth/login already uses; clicking it hits
    // /auth/verify, which both confirms the address and (first time only)
    // grants the Welcome Offer. A failure here is logged, not fatal —
    // the account still exists and works, exactly as if this line didn't
    // run; the user can always request a fresh link via /auth/login.
    try {
      const token = await createToken(user.id, 24);
      const verifyUrl = `${process.env.APP_URL || 'https://www.medhaiq.ai'}/auth/verify?token=${token}`;
      await sendVerificationEmail(cleanEmail, verifyUrl);
    } catch (verifyErr) {
      console.error('[auth] signup verification email error:', verifyErr);
    }

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

    // Proof of email ownership (the token could only have been received
    // at that address) — this is the actual verification moment for both
    // the magic-link path and the password-signup verification email
    // sent from /auth/signup above. First time only, this also attempts
    // the one-time Welcome Offer grant.
    await handleFirstVerification(req, userId);

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