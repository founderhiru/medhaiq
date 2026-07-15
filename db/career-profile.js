// db/career-profile.js — career_profiles DB access, incl. Resume Intelligence.
// career_profiles is bootstrapped for every user at signup (db/profile-bootstrap.js),
// so a row is always expected to exist by the time these functions are called.
const { pool } = require('./index');

/** Fetch the user's career profile, including Resume Intelligence fields (or null). */
async function getCareerProfile(userId) {
  const result = await pool.query(
    `SELECT * FROM career_profiles WHERE user_id = $1`,
    [userId]
  );
  return result.rows[0] || null;
}

/**
 * Persist a freshly-parsed resume onto the user's career profile.
 * Called ONLY from the resume upload/replace flow (routes/resume.js) —
 * never from interview setup or session creation.
 */
async function saveResumeIntelligence(userId, { rawText, resumeCompetencies, resumeContext, storyLibrary }) {
  const result = await pool.query(
    `INSERT INTO career_profiles (user_id, resume_raw_text, resume_competencies, resume_context, story_library, resume_parsed_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       resume_raw_text = EXCLUDED.resume_raw_text,
       resume_competencies = EXCLUDED.resume_competencies,
       resume_context = EXCLUDED.resume_context,
       story_library = EXCLUDED.story_library,
       resume_parsed_at = NOW()
     RETURNING *`,
    [
      userId,
      rawText || null,
      resumeCompetencies ? JSON.stringify(resumeCompetencies) : null,
      resumeContext ? JSON.stringify(resumeContext) : null,
      (storyLibrary && storyLibrary.length) ? JSON.stringify(storyLibrary) : null,
    ]
  );
  return result.rows[0];
}

module.exports = { getCareerProfile, saveResumeIntelligence };
