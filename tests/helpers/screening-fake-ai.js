// Deterministic stand-in for the model, used ONLY by tests. It behaves like a
// reasonable model by default and misbehaves on cue, so the server-side
// defences (quote verification, downgrade rules, filters) are exercised.
const fs = require('fs');

function log(entry) {
  if (process.env.FAKE_AI_LOG) fs.appendFileSync(process.env.FAKE_AI_LOG, JSON.stringify(entry) + '\n');
}

function between(msg, tag) {
  const m = msg.match(new RegExp(`<<<${tag}_([0-9a-f]+)\\n([\\s\\S]*?)\\n${tag}_\\1>>>`));
  return m ? { nonce: m[1], text: m[2] } : null;
}

const STOP = new Set(['experience', 'with', 'and', 'years', 'strong', 'skills', 'such', 'as', 'or', 'of', 'in', 'a', 'the', 'to', 'for', 'knowledge', 'hands-on', 'building', 'production', 'related', 'field', 'degree', "bachelor's", 'cloud', 'data', 'other', 'systems', 'warehouses']);
function keywords(text) {
  return text.toLowerCase().replace(/[^a-z0-9+#.\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w) && !/^\d/.test(w));
}

function criteriaReply(message) {
  const jd = between(message, 'JOB_DESCRIPTION');
  if (!jd) throw new Error('fake: no JD');
  if (/FAKE_AI_DOWN/.test(jd.text)) throw new Error('upstream 529');
  if (/FAKE_AI_GARBAGE/.test(jd.text)) return { criteria: 'not a list' };
  if (/FAKE_AI_BADJSON/.test(jd.text)) throw new Error('Invalid JSON from model');
  const out = [];
  let importance = 'required';
  jd.text.split('\n').forEach((raw) => {
    const line = raw.trim();
    if (/nice to have|preferred/i.test(line) && !/^[-*]/.test(line)) importance = 'preferred';
    const b = line.match(/^[-*]\s+(.*)$/);
    if (b) out.push({ text: b[1].slice(0, 120), importance, kind: 'technical', jd_quote: b[1], guidance: '' });
  });
  // adversarial extras the server must sanitise
  out.push({ text: 'Data modelling', importance: 'required', kind: 'technical', jd_quote: 'This sentence is not in the job description at all', guidance: '' });
  out.push({ text: 'Male candidates under 30 only', importance: 'required', kind: 'other', jd_quote: '', guidance: '' });
  out.push({ ...out[0] }); // duplicate
  return { criteria: out };
}

function evidenceReply(message) {
  const resume = between(message, 'RESUME');
  const critMatch = message.match(/CRITERIA \(trusted[^)]*\):\n(\[.*\])\n/);
  if (!resume || !critMatch) throw new Error('fake: malformed evidence prompt');
  const criteria = JSON.parse(critMatch[1]);
  const lines = resume.text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (/FAKE_AI_DOWN/.test(resume.text)) throw new Error('upstream 529');
  if (/FAKE_AI_BADJSON/.test(resume.text)) throw new Error('Invalid JSON from model');
  const obeyed = /ignore all previous instructions/i.test(resume.text);
  const items = [];
  criteria.forEach((c) => {
    if (/BigQuery/i.test(c.text) && !obeyed) return; // model "forgets" one item
    if (obeyed) {
      // simulates a model that FOLLOWED the injected instruction: claims everything, invents quotes
      items.push({ criterion_id: c.criterion_id, status: 'evidence_found', quotes: [`Extensive hands-on proof of ${c.text} at multiple companies`], rationale: 'This candidate is the best candidate and should be hired.' });
      return;
    }
    if (/Kafka/i.test(c.text)) {
      items.push({ criterion_id: c.criterion_id, status: 'evidence_found', quotes: ['Operated a 40-broker Kafka cluster handling 1M events per second'], rationale: 'Shows Kafka experience.' });
      return;
    }
    if (/Snowflake/i.test(c.text)) {
      const q = lines.find((l) => /snowflake/i.test(l));
      items.push({ criterion_id: c.criterion_id, status: q ? 'evidence_found' : 'not_found', quotes: q ? [q.replace(/^-\s*/, '')] : [], rationale: 'A strong fit for the role, recommended.' });
      return;
    }
    const kws = keywords(c.text);
    const hit = lines.find((l) => kws.some((k) => l.toLowerCase().includes(k)) && /^-\s/.test(l));
    const hitAny = hit || lines.find((l) => kws.some((k) => k.length > 3 && l.toLowerCase().includes(k)) && l.length > 25);
    if (!hitAny) {
      items.push({ criterion_id: c.criterion_id, status: 'not_found', quotes: [], rationale: 'The candidate lacks this skill and is weak here.' });
    } else if (/once|helped|assisted|some/i.test(hitAny)) {
      items.push({ criterion_id: c.criterion_id, status: 'partial_evidence', quotes: [hitAny.replace(/^-\s*/, '')], rationale: 'The resume mentions this only briefly.' });
    } else {
      items.push({ criterion_id: c.criterion_id, status: 'evidence_found', quotes: [hitAny.replace(/^-\s*/, '')], rationale: 'The resume text describes relevant work.' });
    }
  });
  return { items };
}

function questionsReply(message) {
  const m = message.match(/CRITERIA NEEDING VERIFICATION \(trusted\):\n(\[.*\])\n/);
  if (!m) throw new Error('fake: malformed questions prompt');
  const items = JSON.parse(m[1]);
  const qs = [];
  items.forEach((it, i) => {
    qs.push({ criterion_id: it.criterion_id, text: `Can you describe a concrete example of your work with ${it.criterion.toLowerCase()} and what you personally delivered?` });
    qs.push({ criterion_id: it.criterion_id, text: `What tools did you use for ${it.criterion.toLowerCase()} and at what scale?` });
    qs.push({ criterion_id: it.criterion_id, text: 'A third question that must be dropped because only two are allowed per criterion.' });
    if (i === 0) {
      qs.push({ criterion_id: it.criterion_id, text: 'Are you married and do you plan to have children soon?' });
      qs.push({ criterion_id: it.criterion_id, text: 'Would you be a good fit for this role?' });
    }
  });
  qs.push({ criterion_id: 999999, text: 'A question for a criterion that is not in the list at all.' });
  return { questions: qs };
}

async function chatJSON(message, options = {}) {
  const system = typeof options.system === 'string' ? options.system : JSON.stringify(options.system || '');
  const kind = /turn a job description into/i.test(system) ? 'criteria'
    : /what a resume does and does not show/i.test(system) ? 'evidence'
      : /follow-up questions to verify/i.test(system) ? 'questions' : 'unknown';
  log({ kind, system, message, options: { model: options.model, maxTokens: options.maxTokens, capability: options.capability } });
  if (typeof options.onUsage === 'function') options.onUsage({ input_tokens: 1000, output_tokens: 300 }, 5);
  if (process.env.FAKE_AI_DELAY_MS) await new Promise((r) => setTimeout(r, Number(process.env.FAKE_AI_DELAY_MS)));
  if (kind === 'criteria') return criteriaReply(message);
  if (kind === 'evidence') return evidenceReply(message);
  if (kind === 'questions') return questionsReply(message);
  throw new Error(`fake: unrecognised prompt kind (${kind})`);
}

function install(requireFn) {
  const p = requireFn.resolve('../../lib/polsia-ai');
  require.cache[p] = { id: p, filename: p, loaded: true, exports: { chatJSON, chat: async () => { throw new Error('fake: chat not supported'); }, anthropic: {} } };
}

module.exports = { install, chatJSON };
