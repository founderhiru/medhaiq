// db/founder-users.js
// Read-only user list for Founder Dashboard → Section 3 (User Management).
// Last Login is deliberately NOT a users.last_login column — it's derived
// from the login events routes/auth.js already logs via
// services/activity-logger.js. Approved explicitly: don't duplicate data
// the activity log already tracks (see conversation history).
const { pool } = require('./index');
const { getActivePackageAcquisitionsForUsers, createPackageAcquisition } = require('./package-acquisitions');
const { DEFAULT_PACKAGE_ID } = require('../config/product-packages');
const { ensureUserBootstrap } = require('./profile-bootstrap');
const { saveResumeIntelligence } = require('./career-profile');
const { parseResume } = require('../services/resume-parser');

const LOGIN_ACTIONS = ['login_google', 'login_password', 'login_magic_link_verified'];

// Simple, bounded search/list — no advanced CRM functionality per spec.
async function listUsers({ search = '', limit = 25, offset = 0 } = {}) {
  const searchTerm = `%${search.trim().toLowerCase()}%`;
  const res = await pool.query(
    `SELECT
       u.id, u.name, u.email, u.subscription_plan, u.subscription_status, u.created_at,
       (SELECT MAX(al.created_at) FROM user_activity_logs al
          WHERE al.app_user_id = u.id AND al.action = ANY($3::text[])) AS last_login,
       (SELECT COUNT(*) FROM interview_sessions s
          WHERE s.user_id = u.id AND s.status = 'completed') AS interviews_completed
     FROM users u
     WHERE ($1 = '' OR LOWER(u.name) LIKE $2 OR LOWER(u.email) LIKE $2)
     ORDER BY u.created_at DESC
     LIMIT $4 OFFSET $5`,
    [search.trim(), searchTerm, LOGIN_ACTIONS, limit, offset]
  );
  const rows = res.rows;

  // Package (Architecture v1.5, ADR-013) — resolved from package_acquisitions,
  // NEVER from u.subscription_plan/subscription_status above (those two
  // columns are only still selected here for the Founder Dashboard's own
  // historical reference /the pre-existing "Status" column display, not
  // for anything package-related). One batched query for the whole page
  // of users, not one query per row.
  const packageMap = await getActivePackageAcquisitionsForUsers(rows.map(r => r.id));
  return rows.map(r => ({ ...r, package_id: packageMap[r.id] || DEFAULT_PACKAGE_ID }));
}

// A genuinely fictional, generic sample resume — run through the SAME
// parseResume() pipeline every real upload goes through (routes/resume.js),
// so "Seed Sample Data" produces real, computed competencies and story
// library, never hand-authored fake output. Composite/generic on purpose,
// not modeled on any real person.
const SAMPLE_RESUME_TEXT = `Alex Morgan
Senior Product Manager

EXPERIENCE

Product Manager, Northwind Retail Co. (2021–Present)
- Led a cross-functional team of 8 engineers and 2 designers to launch a new checkout flow, reducing cart abandonment by 14%.
- Managed a $2M annual product budget across three initiatives.
- Partnered with a difficult enterprise stakeholder on a delayed integration, ultimately renegotiating scope to hit a revised launch date two weeks early.
- Ran quarterly roadmap planning with executive stakeholders, balancing conflicting priorities between Sales and Engineering.

Associate Product Manager, Fieldstone Analytics (2018–2021)
- Owned the onboarding funnel for a B2B SaaS analytics product, improving activation rate from 22% to 38%.
- Coordinated a beta program with 40 external customers, synthesizing feedback into a prioritized backlog.

EDUCATION
B.S. Business Administration, University of Michigan

SKILLS
Roadmapping, stakeholder management, SQL, A/B testing, agile delivery`;

/**
 * Founder Dashboard → "Create User" — supports both real and demo
 * accounts through one path (Demo Account / Skip Email Verification /
 * Seed Sample Data are independent toggles, not separate modes).
 *
 * No password_hash is ever set here. This is safe and requires no change
 * to routes/auth.js: magic-link login only checks for an active
 * invitation when the user is brand new (isNewUser = !existingUser) — a
 * founder-created user already exists in `users`, so that gate is skipped
 * automatically the moment they try to log in.
 *
 * Composes existing, already-transactional/idempotent building blocks in
 * sequence — the same composition pattern routes/auth.js already uses
 * (findOrCreateUser -> acceptInvitation -> ensureUserBootstrap):
 *   1. INSERT INTO users (this function, own uniqueness check)
 *   2. ensureUserBootstrap — profile/preferences/workspace/career_profile
 *   3. createPackageAcquisition — package + starting credit grant
 *   4. (optional) Resume Intelligence seeded through the real parseResume()
 *      pipeline, saved through the real saveResumeIntelligence() — never
 *      a fabricated/hand-written result.
 *
 * A seeding failure is deliberately non-fatal: the account, profile, and
 * package are already committed by that point, so the function still
 * returns success — { seeded: false } just tells the caller to prompt for
 * a manual resume upload instead.
 */
async function createUserAsFounder({
  fullName, email, packageId, aiMinutes, isDemo, skipEmailVerification, seedSampleData, createdBy,
}) {
  const cleanEmail = email.trim().toLowerCase();
  const cleanName = fullName.trim();

  const existing = await pool.query(
    'SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1',
    [cleanEmail]
  );
  if (existing.rows.length > 0) {
    throw new Error('An account with this email already exists.');
  }

  const inserted = await pool.query(
    `INSERT INTO users (email, name, is_demo, email_verified, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [cleanEmail, cleanName || null, !!isDemo, !!skipEmailVerification, createdBy || null]
  );
  const user = inserted.rows[0];

  await ensureUserBootstrap(user.id);

  // Open-ended (no expiry) — same 'testing/beta/support, not a timed
  // purchase' precedent as reassignPackage()'s admin_grant path.
  await createPackageAcquisition({
    userId: user.id,
    packageId,
    source: 'founder_grant',
    grantedBy: createdBy || null,
    initialMinutes: aiMinutes,
  });

  let seeded = false;
  if (seedSampleData) {
    try {
      const parsed = await parseResume(SAMPLE_RESUME_TEXT);
      const isGenuineSuccess = parsed.parse_status === 'SUCCESS' &&
        ((parsed.resume_competencies && parsed.resume_competencies.length) || (parsed.career_story_library && parsed.career_story_library.length));
      if (isGenuineSuccess) {
        await saveResumeIntelligence(user.id, {
          rawText: SAMPLE_RESUME_TEXT,
          resumeCompetencies: parsed.resume_competencies,
          resumeContext: parsed.resume_context,
          storyLibrary: parsed.career_story_library,
          parseStatus: parsed.parse_status,
        });
        seeded = true;
      }
    } catch (err) {
      console.error('[founder-users] sample resume seed failed:', err.message);
    }
  }

  return { user, seeded };
}

module.exports = { listUsers, createUserAsFounder };
