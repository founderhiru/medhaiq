const passport = require('passport');
const GoogleOAuth2Strategy = require('passport-google-oauth20').Strategy;
const { findOrCreateUserFromGoogle, getUserByEmail, getUserById } = require('../db/auth');
const { acceptInvitation } = require('../db/invitations');
const { ensureUserBootstrap } = require('../db/profile-bootstrap');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const CALLBACK_URL = `${process.env.APP_URL || 'https://www.medhaiq.ai'}/auth/google/callback`;

if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleOAuth2Strategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: CALLBACK_URL,
    scope: ['email', 'profile'],
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile?.emails?.[0]?.value;
      const existingUser = email ? await getUserByEmail(email) : null;
      const isNewUser = !existingUser;

      const user = await findOrCreateUserFromGoogle(profile);

      if (isNewUser) {
        await acceptInvitation(email);
        await ensureUserBootstrap(user.id);
      }

      // isNewUser is additive here — passed through so the one-time call
      // in routes/auth.js's /google/callback (founder signup notification)
      // knows whether this is a genuine new account vs. a returning
      // user's login, without a second DB lookup. Does not touch
      // serializeUser/deserializeUser below, so session storage and every
      // later request's req.user shape are unchanged.
      return done(null, { id: user.id, email: user.email, name: user.name, isNewUser });
    } catch (err) {
      console.error('[passport] Google verify error:', err);
      return done(err);
    }
  }));
}

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await getUserById(id);
    done(null, user ? { id: user.id, email: user.email, name: user.name } : null);
  } catch (err) {
    done(err);
  }
});

module.exports = passport;