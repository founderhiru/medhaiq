# MedhaIQ.ai — AI Orchestrator Migration — STATUS AS OF July 8, 2026

**Purpose of this file:** Paste or upload this back into a new conversation with Claude to resume exactly where this migration left off, with zero re-explanation needed.

---

## ✅ Completed and verified (all committed to `main` on github.com/founderhiru/medhaiq)

| File | Status | Verified how |
|---|---|---|
| `ai/config/models.js` | Committed | `node -e` prints expected model constants, no errors |
| `ai/config/capabilities.js` | Committed | `node -e` prints all 4 capability configs correctly, no errors |
| `ai/core/normalizer.js` | Committed | 3 tests: text passthrough works, JSON-with-fences parses correctly, **invalid JSON correctly throws** (critical — this preserves the fallback logic in `scoreAnswer`/`generateReport`/`extractJdCompetencies`) |
| `ai/core/retry.js` | Committed | 2 tests: disabled retry calls once and returns correctly; disabled retry does NOT swallow errors, throws straight through |
| `ai/core/telemetry.js` | Committed | 2 tests: success case logs + returns value unchanged; failure case logs + still throws (never swallows) |
| `ai/providers/anthropic.js` | Committed | 4 tests, including **live side-by-side calls** against the real production `lib/polsia-ai.js` for both plain text (`"pong"` vs `"pong"`) and JSON (`{ok:true}` vs `{ok:true}`) — outputs matched exactly |
| `ai/legacy-shim.js` | Committed | 3 tests, including live side-by-side against `lib/polsia-ai.js` with **no model override** — shim's own default matched the legacy wrapper exactly on both text and JSON paths |

**Current state of the live app:** Completely unchanged. Nothing above is imported by `server.js`, `services/`, or `routes/` yet. Zero risk, zero behavior change so far — this is all new, inert code sitting safely in the repo.

---

## ⏭️ Next step — THE ONE-LINE CUTOVER (not yet done)

This is the next and only remaining action before real traffic touches any of the new code:

1. Open `lib/polsia-ai.js` on github.com (**edit the existing file**, not create a new one).
2. Replace its entire contents with:
   ```javascript
   module.exports = require('../ai/legacy-shim');
   ```
3. Commit directly to `main`. Suggested message: `lib/polsia-ai.js now delegates to ai/legacy-shim.js (verified equivalent, see migration status doc)`.
4. Deploy (Render auto-deploys on push, or trigger manually).
5. **Watch real traffic before doing anything else**: run a real interview session yourself end to end (question → answer → score → report if possible). Confirm it behaves exactly as before. Check Render logs — you should now see `[ai:telemetry]` lines appearing for real sessions, which confirms the new path is actually live.

---

## After the cutover — remaining migration steps (not started yet)

**Step 4 — one capability at a time, in this order** (lowest to highest blast radius):
1. `extractJdCompetencies` (in `services/harmonicAlignmentEngine.js`) — has a safe heuristic fallback, lowest traffic
2. `scoreAnswer` (in `services/interview.js`)
3. `generateNextQuestion` (in `services/interview.js`) — live session, latency-sensitive
4. `generateReport` (in `services/interview.js`) — runs at end of session, highest blast radius

Each one: swap that single call site from `chat`/`chatJSON` to the orchestrator's named method (once `ai/index.js` and `ai/capabilities/*.js` are built — these haven't been built yet), test, ship, observe, then move to the next.

**Step 5 — formalize TTS**: replace the inline `require('openai')` in `routes/interview.js` with a proper `ai/providers/openai.js` + `ai/capabilities/textToSpeech.js`. Also remember: `package.json` is still missing the `openai` dependency (only in the lockfile) — fix that alongside this step.

**Step 6 — remove legacy code**: delete `lib/polsia-ai.js` and `ai/legacy-shim.js` once nothing imports them anymore.

**Also still pending, low priority, no rush**: Step 0 housekeeping — deleting the confirmed-dead files found in the original audit (root `polsia-ai.js`, `lib/generate-report.js`, `routes/3.interview.js`, `controllers/sessionController _claude copy.js`, four orphaned `*interview-session*.ejs` view copies).

---

## Key compatibility decisions made (don't relitigate these without reason)

- `LEGACY_DEFAULT_MODEL` deliberately preserves the exact string `'claude-haiku-4-5'` (no date suffix) — this is what production actually uses today.
- Every capability's `cache: true` matches today's unconditional prompt caching.
- Every capability's `retry.enabled: false` matches today's total absence of retry logic. Retries are scaffolded but off, to avoid adding latency to the live-session question-generation path.
- `normalizeJSON()` intentionally throws on invalid JSON — never wrap this in a try/catch that swallows the error, or you'll silently break 3 existing fallback behaviors.
- Model differentiation per capability (e.g. moving `generateReport` to a stronger model) is a deliberate future decision, not something to do casually — it wasn't part of this phase on purpose.

---

**To resume:** upload this file back to Claude and say something like "let's continue the MedhaIQ migration from here" — everything needed to pick back up is above.
