# Screening & Assessment Copilot — how it works

Plain-language guide for the founder, plus what to check before real candidate data goes in.
Branch: `founder-dashboard-staging`. Nothing here touches production until you merge.

## What it does (and does not do)

1. **Job description → criteria.** The recruiter pastes or uploads a JD. AI proposes required and
   preferred criteria. The recruiter edits and **approves** the list. Nothing is checked against a
   resume until the list is approved. If the AI is down, a simple bullet-point reader proposes
   criteria instead (clearly labelled).
2. **Resumes in.** One or many PDF / Word files (or pasted text). Names, emails, phone numbers,
   links and fields like age/gender are removed **before** storage and before any AI call. The
   original file and its filename are never stored. Candidates appear as `C-001`, `C-002`…
3. **Evidence mapping.** For each approved criterion the AI reports one of five statuses:
   Evidence Found, Partial Evidence, Not Found in Resume, Requires Verification, Not Applicable
   (Not Applicable can only be set by a person). Every "found" claim carries an exact quote from
   the resume.
4. **Evidence Inbox.** Candidates are grouped by what the *required* criteria show — in upload
   order, never ranked.
5. **Human review.** The recruiter confirms or changes any finding. The AI's finding and the
   human's change are stored side by side.
6. **Verification questions.** For partial / not found / unclear items, AI drafts up to two neutral
   follow-up questions. The recruiter edits, approves or deletes them, and can add their own.
7. **Decision.** Only the recruiter sets Shortlist / Hold / Needs Verification / Not Moving Forward.
8. **Report.** A print-friendly page (browser "Save as PDF") that separates *AI extraction* from
   *Recruiter reviewed* and repeats the limitations.

There is **no score, no ranking, no percentage and no hire/reject recommendation** anywhere. The
API strips any key that looks like one, and a test fails the build if one appears.

## Safety rules enforced in code (not just in prompts)

| Risk | Defence |
|---|---|
| AI invents a quote | Every quote is searched for in the stored resume text (whitespace/quote-style tolerant, one continuous passage, no "…"). A "found" claim whose quote is not found becomes **Requires Verification** and says why. |
| "Not found" turns into "lacks the skill" | The AI's wording for Not Found is discarded; a fixed sentence is stored: *"…does not mean the candidate lacks the skill or experience."* |
| AI uses hiring language | Rationales containing words like hire / reject / strong fit / recommend are removed. |
| Resume tries to instruct the AI | Resume is wrapped in nonce-delimited "untrusted data" blocks; output must pass schema + quote checks; instruction-like text is flagged to the recruiter. Tested with a model that *obeys* the injection — nothing gets through. |
| Bias inputs | Identifiers redacted before AI. Criteria about age, gender, marital status, religion, caste, nationality, appearance are refused (even if the AI or recruiter proposes them). JD language of that kind is flagged. |
| Criteria change after analysis | Findings carry the criteria version; changing approved criteria marks them **Out of date**. Re-running asks before discarding the recruiter's reviews. |
| Cross-account access | Every query is scoped to the signed-in owner; another account's ids behave as "not found". Tested for all 20 data routes. |
| Hostile files | Type decided by file bytes; DOCX zip inspected before opening (size, entry count, encryption); PDF page cap; parsing in a worker thread with memory cap and timeout; scanned PDFs rejected with a clear message. |
| Cost / abuse | Per-account rate limits and a daily AI-call cap; every AI call is logged with token counts (`screening_ai_runs`). |
| XSS | Server pages use escaped EJS; browser script never uses innerHTML; tested with hostile labels and resume text. |

## Who can use it

Access is a founder-granted allowlist, separate from subscription plans (it never reads the
Capability Engine). Founders are always allowed.

Grant access (while signed in as a founder, from the browser console on any MedhaIQ page):

```js
fetch('/api/founder/screening/access', {method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({email:'recruiter@company.com', note:'pilot'})}).then(r=>r.json()).then(console.log)
```

Revoke: `fetch('/api/founder/screening/access/<userId>', {method:'DELETE'})`.
List: `fetch('/api/founder/screening/access').then(r=>r.json()).then(console.log)`.

The "Screening" sidebar link appears on the Workspace page for users with access.

## Files added

- `config/screening.js` — all limits, labels, thresholds
- `db/screening-migration.js` (+ one line in `db/migrate.js`) — migration `035_screening_copilot`, additive only
- `db/screening.js` — owner-scoped data access
- `lib/screening-*.js` — redaction, flags, evidence rules, criteria helpers, errors
- `services/screening/*`, `services/prompts/screening-*.js` — extraction, AI calls, services
- `middleware/screening-guards.js`, `middleware/screening-rate-limit.js`
- `routes/screening.js` (API), `routes/screening-admin.js` (founder), `routes/screening-pages.js`
- `views/screening-*.ejs`, `public/js/screening.js`, CSS appended to `public/css/recruit-screening.css`
- `tests/screening-*.js`, `tests/helpers/screening-*.js`

Existing files edited: `server.js` (mounts + one sidebar flag), `db/migrate.js` (one line),
`views/partials/workspace-shell-top.ejs` (one optional link).

## Rollback

Code: revert the files above. Database (staging only):

```sql
DROP TABLE screening_ai_runs, screening_questions, screening_evidence, screening_candidates,
           screening_criteria, screening_jobs, screening_access CASCADE;
DELETE FROM _migrations WHERE name = '035_screening_copilot';
```

## Environment variables (all optional)

- `SCREENING_AI_MODEL` — use a different model for screening only (default: app default)
- `SCREENING_DAILY_AI_CAP` — AI calls per account per 24 h (default 400)

## Before real candidate data

- **Prompts have not been run against a live model in this build** (no API key in the build
  environment). Run 5–10 real JDs/resumes on staging and read the findings before any pilot.
- **Legal review.** Candidate resumes are personal data (India DPDP Act 2023) and AI-assisted
  hiring is increasingly regulated. Get a privacy notice, a retention rule and a data-processing
  agreement with pilot customers reviewed. Deleting a candidate or role hard-deletes everything
  under it; deleting a user account removes all their screening data.
- Redaction is pattern-based: it catches labelled fields, emails, phones and links, and a name on
  the first line, but not every name written inside a sentence. The UI says so.
- The Anthropic API receives the redacted resume text. Confirm your Anthropic data-retention terms.
- Scanned (image-only) PDFs are rejected — there is no OCR.
- Rate limits are in-memory (fine for one Render instance; use a shared store if you scale out).
- Optional AI interview step is **not** built; the Interview Engine is untouched.
