// middleware/screening-guards.js
//
// Screening access is a founder-granted pilot allowlist (screening_access),
// not a subscription capability, so — like campus-guards.js — it lives
// outside middleware/guards.js and the Capability Engine. Founders are
// implicitly allowed. API guards return JSON; page guards redirect/render.

const { getUserById } = require('../db/auth');
const { isFounder } = require('../db/founder-access');
const screeningDb = require('../db/screening');

async function resolveAccess(req) {
  const userId = req.cookies && req.cookies.user_id;
  if (!userId) return { state: 'anonymous' };
  const user = await getUserById(userId);
  if (!user) return { state: 'anonymous' };
  const [founder, granted] = await Promise.all([isFounder(user.id), screeningDb.hasActiveAccess(user.id)]);
  if (!founder && !granted) return { state: 'no_access', user };
  return { state: 'ok', user, founder };
}

async function requireScreeningApi(req, res, next) {
  try {
    const a = await resolveAccess(req);
    if (a.state === 'anonymous') return res.status(401).json({ error: 'Authentication required', code: 'auth_required' });
    if (a.state === 'no_access') return res.status(403).json({ error: 'Screening is not enabled for your account.', code: 'no_access' });
    req.user = a.user;
    req.screeningOwnerId = a.user.id;
    next();
  } catch (err) {
    console.error('[screening] guard error:', err.message);
    res.status(500).json({ error: 'Something went wrong.', code: 'server_error' });
  }
}

async function requireScreeningPage(req, res, next) {
  try {
    const a = await resolveAccess(req);
    if (a.state === 'anonymous') return res.redirect('/auth/login?next=' + encodeURIComponent(req.originalUrl));
    if (a.state === 'no_access') {
      return res.status(403).render('screening-no-access', { shellUser: a.user, activeNav: 'screening', isScreeningUser: false });
    }
    req.user = a.user;
    req.screeningOwnerId = a.user.id;
    next();
  } catch (err) {
    console.error('[screening] page guard error:', err.message);
    res.status(500).send('Something went wrong.');
  }
}

async function requireFounderApi(req, res, next) {
  try {
    const userId = req.cookies && req.cookies.user_id;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const user = await getUserById(userId);
    if (!user) return res.status(401).json({ error: 'Session expired' });
    if (!(await isFounder(user.id))) return res.status(403).json({ error: 'Forbidden' });
    req.user = user;
    next();
  } catch (err) {
    console.error('[screening] founder guard error:', err.message);
    res.status(500).json({ error: 'Something went wrong.' });
  }
}

// Defence in depth on top of SameSite=Lax: a state-changing request that
// carries an Origin header must come from this host.
function sameOriginOnly(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const origin = req.get('origin');
  if (!origin) return next();
  let host;
  try { host = new URL(origin).host; } catch (_) { host = null; }
  if (host && host === req.get('host')) return next();
  return res.status(403).json({ error: 'Cross-site request blocked.', code: 'bad_origin' });
}

module.exports = { requireScreeningApi, requireScreeningPage, requireFounderApi, sameOriginOnly, resolveAccess };
