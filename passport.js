const passport = require('passport');
const GoogleOAuth2Strategy = require('passport-google-oauth20').Strategy;
const { findOrCreateUserFromGoogle } = require('../db/auth');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const CALLBACK_URL = `https://hirable-2nwo.polsia.app/auth/google/callback`;

if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleOAuth2Strategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: CALLBACK_URL,
    scope: ['email', 'profile'],
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const user = await findOrCreateUserFromGoogle(profile);
      return done(null, { id: user.id, email: user.email, name: user.name });
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
    const { getUserById } = require('../db/auth');
    const user = await getUserById(id);
    done(null, user ? { id: user.id, email: user.email, name: user.name } : null);
  } catch (err) {
    done(err);
  }
});

module.exports = passport;