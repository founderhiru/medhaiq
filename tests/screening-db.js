// Screening Copilot — database layer tests against a REAL Postgres.
//   DATABASE_URL=postgres://… node tests/screening-db.js
const assert = require('assert');
const crypto = require('crypto');
const { t, group, finish } = require('./helpers/mini-test');
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(2); }
const { pool } = require('../db/index');
const sdb = require('../db/screening');
const cfg = require('../config/screening');
const migration = require('../db/screening-migration');

const RUN = Date.now().toString(36);
const hash = () => crypto.randomBytes(16).toString('hex').padEnd(64, '0');
const cand = (over = {}) => ({ sourceType: 'text', fileHash: hash(), text: 'Resume text '.repeat(20), pageOffsets: [0], pageCount: 1, redactionSummary: {}, injectionFlags: [], label: null, ...over });
const expectErr = async (p, code) => { try { await p; } catch (e) { assert.strictEqual(e.code, code, `${e.code}: ${e.message}`); return; } assert.fail(`expected ${code}`); };

(async () => {
  const mk = async (k) => (await pool.query('INSERT INTO users (email,name) VALUES ($1,$2) RETURNING id', [`scrdb-${RUN}-${k}@example.test`, k])).rows[0].id;
  const u1 = await mk('one'); const u2 = await mk('two');
  try {
    group('Migration 035');
    await t('is recorded once and is idempotent when re-run', async () => {
      assert.strictEqual((await pool.query(`SELECT COUNT(*)::int n FROM _migrations WHERE name='035_screening_copilot'`)).rows[0].n, 1);
      const c = await pool.connect();
      try { await c.query('BEGIN'); await migration.up(c); await migration.up(c); await c.query('COMMIT'); } finally { c.release(); }
    });
    await t('all seven tables exist; no existing table was altered', async () => {
      const r = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'screening\\_%' ORDER BY 1`);
      assert.deepStrictEqual(r.rows.map((x) => x.table_name), ['screening_access', 'screening_ai_runs', 'screening_candidates', 'screening_criteria', 'screening_evidence', 'screening_jobs', 'screening_questions']);
      const users = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='users'`)).rows.map((x) => x.column_name);
      assert(!users.some((c) => /screening/.test(c)), 'users table must be untouched');
    });
    await t('database CHECK constraints reject invalid states', async () => {
      const job = await sdb.createJob(u1, { title: 'Chk', jdText: 'x'.repeat(130), jdFlags: [] });
      await assert.rejects(pool.query(`UPDATE screening_jobs SET criteria_state='bogus' WHERE id=$1`, [job.id]));
      await assert.rejects(pool.query(`INSERT INTO screening_criteria (job_id,text,importance) VALUES ($1,'abc','critical')`, [job.id]));
      const c = await sdb.createCandidate(u1, job.id, cand());
      await assert.rejects(pool.query(`UPDATE screening_candidates SET decision='hire' WHERE id=$1`, [c.candidate.id]));
      await assert.rejects(pool.query(`UPDATE screening_candidates SET decision='rejected' WHERE id=$1`, [c.candidate.id]));
      await sdb.replaceCriteria(u1, job.id, [{ text: 'SQL', importance: 'required', kind: 'technical', jd_quote: null, jd_quote_verified: false, guidance: null, origin: 'recruiter' }]);
      const crit = (await sdb.listCriteria(u1, job.id))[0];
      await assert.rejects(pool.query(`INSERT INTO screening_evidence (candidate_id,criterion_id,ai_status) VALUES ($1,$2,'not_applicable')`, [c.candidate.id, crit.id]), 'AI may never store not_applicable');
      await assert.rejects(pool.query(`INSERT INTO screening_evidence (candidate_id,criterion_id,ai_status) VALUES ($1,$2,'excellent')`, [c.candidate.id, crit.id]));
      await assert.rejects(pool.query(`INSERT INTO screening_questions (candidate_id,criterion_id,text,state) VALUES ($1,$2,'abc','sent')`, [c.candidate.id, crit.id]));
      await sdb.deleteJob(u1, job.id);
    });

    group('Candidates');
    const job = await sdb.createJob(u1, { title: 'Concurrency', jdText: 'x'.repeat(130), jdFlags: [] });
    await t('parallel inserts get unique, gap-free-per-attempt codes', async () => {
      const rs = await Promise.all(Array.from({ length: 25 }, () => sdb.createCandidate(u1, job.id, cand())));
      const codes = rs.map((r) => sdb.candidateCode(r.candidate.seq));
      assert.strictEqual(new Set(codes).size, 25);
    });
    await t('parallel uploads of the same file create exactly one candidate', async () => {
      const h = hash();
      const rs = await Promise.all(Array.from({ length: 8 }, () => sdb.createCandidate(u1, job.id, cand({ fileHash: h }))));
      assert.strictEqual(rs.filter((r) => !r.duplicate).length, 1);
      assert.strictEqual(rs.filter((r) => r.duplicate).length, 7);
    });
    await t('the same file may be added to a different role (uniqueness is per role)', async () => {
      const other = await sdb.createJob(u1, { title: 'Other', jdText: 'x'.repeat(130), jdFlags: [] });
      const h = hash();
      assert(!(await sdb.createCandidate(u1, job.id, cand({ fileHash: h }))).duplicate);
      assert(!(await sdb.createCandidate(u1, other.id, cand({ fileHash: h }))).duplicate);
    });
    await t('codes are never reused after deletion', async () => {
      const a = (await sdb.createCandidate(u1, job.id, cand())).candidate;
      await sdb.deleteCandidate(u1, a.id);
      const b = (await sdb.createCandidate(u1, job.id, cand())).candidate;
      assert(b.seq > a.seq);
    });
    await t('per-role candidate limit is enforced', async () => {
      const lim = await sdb.createJob(u1, { title: 'Limit', jdText: 'x'.repeat(130), jdFlags: [] });
      await pool.query(`INSERT INTO screening_candidates (job_id,owner_id,seq,source_type,file_hash,redacted_text)
        SELECT $1,$2,g,'text',md5(g::text)||md5(g::text),'t' FROM generate_series(1,$3) g`, [lim.id, u1, cfg.LIMITS.CANDIDATES_PER_JOB]);
      await pool.query('UPDATE screening_jobs SET candidate_seq=$2 WHERE id=$1', [lim.id, cfg.LIMITS.CANDIDATES_PER_JOB]);
      await expectErr(sdb.createCandidate(u1, lim.id, cand()), 'candidate_limit');
      await sdb.deleteJob(u1, lim.id);
    });
    await t('per-owner role limit is enforced', async () => {
      const lim = await mk('limit');
      await pool.query(`INSERT INTO screening_jobs (owner_id,title,jd_text) SELECT $1,'r'||g,'t' FROM generate_series(1,$2) g`, [lim, cfg.LIMITS.JOBS_PER_OWNER]);
      await expectErr(sdb.createJob(lim, { title: 'One more', jdText: 'x'.repeat(130), jdFlags: [] }), 'job_limit');
    });

    group('Owner scoping (every function returns nothing for another owner)');
    await t('no read or write works across owners', async () => {
      const j = await sdb.createJob(u1, { title: 'Mine', jdText: 'x'.repeat(130), jdFlags: [] });
      await sdb.replaceCriteria(u1, j.id, [{ text: 'SQL', importance: 'required', kind: 'technical', jd_quote: null, jd_quote_verified: false, guidance: null, origin: 'recruiter' }]);
      const crit = (await sdb.listCriteria(u1, j.id))[0];
      const c = (await sdb.createCandidate(u1, j.id, cand())).candidate;
      await sdb.replaceEvidence(u1, c.id, [{ criterion_id: crit.id, ai_status: 'evidence_found', ai_rationale: 'r', quotes: [] }], { criteriaVersion: 0 });
      await sdb.addQuestion(u1, c.id, crit.id, 'Describe a project in detail please?');
      assert.strictEqual(await sdb.getJob(u2, j.id), null);
      assert.deepStrictEqual(await sdb.listCriteria(u2, j.id), []);
      assert.deepStrictEqual(await sdb.listCandidates(u2, j.id), []);
      assert.strictEqual(await sdb.getCandidate(u2, c.id), null);
      assert.deepStrictEqual(await sdb.listEvidence(u2, c.id), []);
      assert.deepStrictEqual(await sdb.listQuestions(u2, c.id), []);
      assert.deepStrictEqual(await sdb.listJobEvidence(u2, j.id), []);
      assert.strictEqual(await sdb.updateJob(u2, j.id, { title: 'x' }), null);
      assert.strictEqual(await sdb.deleteJob(u2, j.id), false);
      assert.strictEqual(await sdb.deleteCandidate(u2, c.id), false);
      assert.strictEqual(await sdb.updateCandidateLabel(u2, c.id, 'x'), null);
      assert.strictEqual(await sdb.setDecision(u2, c.id, 'shortlist', null), null);
      assert.strictEqual(await sdb.reviewEvidence(u2, c.id, crit.id, { status: 'evidence_found' }), null);
      assert.strictEqual(await sdb.clearReview(u2, c.id, crit.id), null);
      assert.strictEqual(await sdb.replaceEvidence(u2, c.id, [], { criteriaVersion: 0 }), null);
      assert.strictEqual(await sdb.replaceAiQuestions(u2, c.id, []), null);
      assert.strictEqual(await sdb.addQuestion(u2, c.id, crit.id, 'Describe a project in detail please?'), null);
      assert.strictEqual(await sdb.replaceCriteria(u2, j.id, []), null);
      assert.strictEqual(await sdb.addCriterion(u2, j.id, { text: 'abc', importance: 'required', kind: 'other' }), null);
      assert.strictEqual(await sdb.approveCriteria(u2, j.id, 'h'), null);
      assert.strictEqual(await createInJob(u2, j.id), null);
      // and the owner's data is untouched
      assert.strictEqual((await sdb.getJob(u1, j.id)).title, 'Mine');
      assert.strictEqual((await sdb.listEvidence(u1, c.id)).length, 1);
    });
    async function createInJob(owner, jobId) { return sdb.createCandidate(owner, jobId, cand()); }
    await t('a question cannot be attached to a criterion from another role', async () => {
      const j1 = await sdb.createJob(u1, { title: 'A', jdText: 'x'.repeat(130), jdFlags: [] });
      const j2 = await sdb.createJob(u1, { title: 'B', jdText: 'x'.repeat(130), jdFlags: [] });
      const row = (j) => [{ text: 'SQL', importance: 'required', kind: 'technical', jd_quote: null, jd_quote_verified: false, guidance: null, origin: 'recruiter' }];
      await sdb.replaceCriteria(u1, j1.id, row()); await sdb.replaceCriteria(u1, j2.id, row());
      const c1 = (await sdb.createCandidate(u1, j1.id, cand())).candidate;
      const crit2 = (await sdb.listCriteria(u1, j2.id))[0];
      assert.strictEqual(await sdb.addQuestion(u1, c1.id, crit2.id, 'Describe a project in detail please?'), null);
    });

    group('Criteria lifecycle');
    await t('approval versions only when content changes; locked while approved', async () => {
      const j = await sdb.createJob(u1, { title: 'Ver', jdText: 'x'.repeat(130), jdFlags: [] });
      await sdb.addCriterion(u1, j.id, { text: 'Python', importance: 'required', kind: 'technical' });
      let a = await sdb.approveCriteria(u1, j.id, 'hash-1'); assert.strictEqual(a.criteria_version, 1);
      await expectErr(sdb.addCriterion(u1, j.id, { text: 'More', importance: 'required', kind: 'other' }), 'criteria_locked');
      await sdb.reopenCriteria(u1, j.id);
      a = await sdb.approveCriteria(u1, j.id, 'hash-1'); assert.strictEqual(a.criteria_version, 1);
      await sdb.reopenCriteria(u1, j.id);
      a = await sdb.approveCriteria(u1, j.id, 'hash-2'); assert.strictEqual(a.criteria_version, 2);
    });
    await t('criteria count limit is enforced', async () => {
      const j = await sdb.createJob(u1, { title: 'Many', jdText: 'x'.repeat(130), jdFlags: [] });
      for (let i = 0; i < cfg.LIMITS.CRITERIA_MAX; i += 1) await sdb.addCriterion(u1, j.id, { text: `Skill ${i}`, importance: 'required', kind: 'other' });
      await expectErr(sdb.addCriterion(u1, j.id, { text: 'One too many', importance: 'required', kind: 'other' }), 'criteria_limit');
    });
    await t('replacing the evidence of a candidate is atomic (failure leaves the old findings)', async () => {
      const j = await sdb.createJob(u1, { title: 'Atomic', jdText: 'x'.repeat(130), jdFlags: [] });
      await sdb.replaceCriteria(u1, j.id, [{ text: 'SQL', importance: 'required', kind: 'technical', jd_quote: null, jd_quote_verified: false, guidance: null, origin: 'recruiter' }]);
      const crit = (await sdb.listCriteria(u1, j.id))[0];
      const c = (await sdb.createCandidate(u1, j.id, cand())).candidate;
      await sdb.replaceEvidence(u1, c.id, [{ criterion_id: crit.id, ai_status: 'evidence_found', ai_rationale: 'old', quotes: [] }], { criteriaVersion: 1 });
      await assert.rejects(sdb.replaceEvidence(u1, c.id, [{ criterion_id: crit.id, ai_status: 'evidence_found', ai_rationale: 'new', quotes: [] }, { criterion_id: crit.id, ai_status: 'evidence_found', ai_rationale: 'dup', quotes: [] }], { criteriaVersion: 2 }));
      const ev = await sdb.listEvidence(u1, c.id);
      assert.strictEqual(ev.length, 1); assert.strictEqual(ev[0].ai_rationale, 'old');
    });

    group('Access table');
    await t('grant / revoke / re-grant; one row per user', async () => {
      await sdb.grantAccess({ userId: u1, grantedBy: u2, note: 'a' });
      assert(await sdb.hasActiveAccess(u1)); assert(await sdb.canUseScreening(u1));
      await sdb.revokeAccess(u1);
      assert(!(await sdb.hasActiveAccess(u1))); assert(!(await sdb.canUseScreening(u1)));
      await sdb.grantAccess({ userId: u1, grantedBy: u2, note: 'b' });
      assert(await sdb.hasActiveAccess(u1));
      assert.strictEqual((await pool.query('SELECT COUNT(*)::int n FROM screening_access WHERE user_id=$1', [u1])).rows[0].n, 1);
      assert.strictEqual(await sdb.revokeAccess(999999999), null);
      assert(!(await sdb.canUseScreening(null)));
    });
    await t('AI run accounting counts only the last 24 hours', async () => {
      const u = await mk('runs');
      await sdb.recordAiRun(u, { kind: 'evidence', ok: true });
      await pool.query(`INSERT INTO screening_ai_runs (owner_id,kind,ok,created_at) VALUES ($1,'evidence',true,NOW()-INTERVAL '25 hours')`, [u]);
      assert.strictEqual(await sdb.countAiRunsToday(u), 1);
    });
  } finally {
    await pool.query('DELETE FROM users WHERE email LIKE $1', [`scrdb-${RUN}-%@example.test`]);
    await pool.end();
  }
  finish('screening-db');
})().catch((e) => { console.error('DB harness error:', e); process.exit(1); });
