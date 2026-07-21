// routes/debug-voice.js
//
// PR3 deliverable of the MedhaIQ Voice Platform Architecture v1.0
// (frozen), per the PR3 Integration Plan's closing recommendation.
//
// A hidden, founder/staff-only diagnostic page that exercises the full
// QuestionSpeechService -> ElevenLabsTTSAdapter -> BrowserAudioPlayer
// chain (Play/Stop/Pause/Resume, voice selection, arbitrary text) --
// the same construction path used by interview-session.ejs when
// VOICE_PLAYBACK_PROVIDER=tts_pipeline, so it doubles as both a fast
// "is voice broken" check and a live rehearsal of the exact PR3 wiring.
//
// Gated with the same requireFounder pattern already used by
// routes/founder.js -- never linked from any nav, GET only, no writes.

const express = require('express');
const router = express.Router();
const { getUserById } = require('../db/auth');
const { isFounder } = require('../db/founder-access');

async function requireFounder(req, res, next) {
  const userId = req.cookies?.user_id;
  if (!userId) return res.status(401).send('Authentication required');
  const user = await getUserById(userId);
  if (!user) return res.status(401).send('Session expired');
  const founder = await isFounder(user.id);
  if (!founder) return res.status(403).send('Forbidden');
  req.user = user;
  next();
}

router.get('/', requireFounder, (req, res) => {
  res.render('debug-voice', {
    // Same bridge pattern as interview-session.ejs -- browser-safe only,
    // never the server-side VOICE_SERVER_CONFIG.
  });
});

module.exports = router;
