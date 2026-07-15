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
/**
 * Persist a freshly-parsed resume onto the user's career profile.
 * Called ONLY from the resume upload/replace flow (routes/resume.js) —
 * never from interview setup or session creation.
 *
 * Hardened save semantics (requirements 4/5/6 from the pipeline hardening):
 * - parseStatus and last-attempt timestamp are ALWAYS recorded, success or
 *   failure — the UI can always tell what actually happened.
 * - Content columns (resume_raw_text/resume_competencies/resume_context/
 *   story_library) are ONLY overwritten when this attempt is a genuine,
 *   non-empty SUCCESS. A technical failure (any non-SUCCESS status) OR a
 *   technically-successful-but-completely-empty result (0 competencies AND
 *   0 stories) NEVER overwrites whatever good data already existed —
 *   resume_parsed_at (the "last good parse" timestamp) only advances when
 *   real content is actually saved.
 * - The one exception: if there's no prior content to protect (first-ever
 *   upload), an empty result is saved as-is — there's nothing to lose.
 */
async function saveResumeIntelligence(userId, { rawText, resumeCompetencies, resumeContext, storyLibrary, parseStatus }) {
  const hasNewContent = !!((resumeCompetencies && resumeCompetencies.length) || (storyLibrary && storyLibrary.length));
  const isGenuineSuccess = parseStatus === 'SUCCESS' && hasNewContent;

  // Determine whether there's existing content worth protecting.
  const existing = await getCareerProfile(userId);
  const hadPriorContent = !!(existing && (
    (Array.isArray(existing.resume_competencies) && existing.resume_competencies.length) ||
    (Array.isArray(existing.story_library) && existing.story_library.length)
  ));

  const shouldUpdateContent = isGenuineSuccess || !hadPriorContent;

  console.log(`[career-profile] save attempt: userId=${userId} parseStatus=${parseStatus} hasNewContent=${hasNewContent} hadPriorContent=${hadPriorContent} willUpdateContent=${shouldUpdateContent}`);

  let result;
  if (shouldUpdateContent) {
    result = await pool.query(
      `INSERT INTO career_profiles (user_id, resume_raw_text, resume_competencies, resume_context, story_library, resume_parse_status, resume_last_parse_attempt_at, resume_parsed_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         resume_raw_text = EXCLUDED.resume_raw_text,
         resume_competencies = EXCLUDED.resume_competencies,
         resume_context = EXCLUDED.resume_context,
         story_library = EXCLUDED.story_library,
         resume_parse_status = EXCLUDED.resume_parse_status,
         resume_last_parse_attempt_at = NOW(),
         resume_parsed_at = NOW()
       RETURNING *`,
      [
        userId,
        rawText || null,
        resumeCompetencies ? JSON.stringify(resumeCompetencies) : null,
        resumeContext ? JSON.stringify(resumeContext) : null,
        (storyLibrary && storyLibrary.length) ? JSON.stringify(storyLibrary) : null,
        parseStatus || null,
      ]
    );
    console.log(`[career-profile] save success: userId=${userId} content updated, resume_parsed_at advanced`);
  } else {
    // Status-only update — existing content columns are left completely
    // untouched. This is the "never destroy previously parsed Resume
    // Intelligence" guarantee: a failed or empty re-parse can never wipe
    // out a candidate's real, previously-extracted data.
    result = await pool.query(
      `INSERT INTO career_profiles (user_id, resume_parse_status, resume_last_parse_attempt_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         resume_parse_status = EXCLUDED.resume_parse_status,
         resume_last_parse_attempt_at = NOW()
       RETURNING *`,
      [userId, parseStatus || null]
    );
    console.log(`[career-profile] save preserved-existing: userId=${userId} status=${parseStatus} — prior content NOT overwritten`);
  }
  return result.rows[0];
}

module.exports = { getCareerProfile, saveResumeIntelligence };
