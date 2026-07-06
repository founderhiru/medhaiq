# Phase 19 — Full 5-vector consistency, homepage included

## Ground truth, verified directly against the actual files (not assumed)

Since Phase 18, your `lib/generate-report.js` has the 5-item vector list
(Structure/Domain Expertise/Strategic Thinking/Leadership & Execution/
Promotion Readiness) with no Communication row. Two more small edits
finish the job — verified by me reading the real file just now, not
guessed.

**Good news: `services/interview.js` needs NO changes.** I checked — the
AI prompt already asks for a `communication` value in its JSON schema.
The gap was only ever in `lib/generate-report.js` not reading it.

## Files in this delivery
1. `hero.ejs` — FULL REPLACEMENT for `views/partials/hero.ejs`
2. `vector-block.ejs` — the same 5-vector block on its own, in case you'd rather paste just that section instead of the whole file
3. `hero-v2-phase19-addition.css` — append to the END of `public/css/hero-v2.css`
4. 2 small edits to `lib/generate-report.js`, below (no new file needed)

## Step 1 — 2 edits in lib/generate-report.js

**Edit A** — find:
```
  const scoreboard = safeParse(report.scoreboard, {
    career_intelligence: report.overall_score, leadership_readiness: 0,
    executive_presence: 0, gcc_readiness: 0, promotion_readiness: report.overall_score,
  });
```
Replace with:
```
  const scoreboard = safeParse(report.scoreboard, {
    career_intelligence: report.overall_score, leadership_readiness: 0,
    executive_presence: 0, gcc_readiness: 0, communication: 0, promotion_readiness: report.overall_score,
  });
```

**Edit B** — find:
```
  const vectors = [
    ['Structure',               scoreboard.career_intelligence,  '#3b82f6'],
    ['Domain Expertise',        scoreboard.leadership_readiness, '#a78bfa'],
    ['Strategic Thinking',      scoreboard.executive_presence,   '#22c55e'],
    ['Leadership & Execution',  scoreboard.gcc_readiness,        '#f59e0b'],
    ['Promotion Readiness',     scoreboard.promotion_readiness,  '#fb923c'],
  ];
```
Replace with:
```
  const vectors = [
    ['Structure',               scoreboard.career_intelligence,  '#3b82f6'],
    ['Domain Expertise',        scoreboard.leadership_readiness, '#a78bfa'],
    ['Strategic Thinking',      scoreboard.executive_presence,   '#22c55e'],
    ['Communication',           scoreboard.communication,        '#fb923c'],
    ['Leadership & Execution',  scoreboard.gcc_readiness,        '#f59e0b'],
  ];
```
Commit both together. "Promotion Readiness" is now completely gone from
this report — Communication has real data and fills the 5th slot properly.

*(Optional, zero visual impact: there's a `buildReadinessSection`
function defined earlier in this same file that is never actually
called anywhere — confirmed by checking every call site. Safe to
delete entirely whenever you want a tidier file; leaving it alone
changes nothing.)*

## Step 2 — Replace hero.ejs entirely
Open `views/partials/hero.ejs`, select all, delete, paste in the new
version from this delivery, commit.

**What changed:** the 5-Vector Intelligence list on your homepage now
reads Structure / Domain Expertise / Strategic Thinking / Communication
/ Leadership & Execution — same order, same colors (blue/purple/green/
orange/amber) as the real interview terminal and reports.

## Step 3 — Append the color CSS
Open `public/css/hero-v2.css`, scroll to the very end, paste in
`hero-v2-phase19-addition.css`, commit.

## Verify
1. Homepage hero mockup shows the final 5 labels in the final order/colors
2. Run a real interview session through to a report — Communication now shows a real score, no Promotion Readiness row
3. Same for the PDF/email version if you use it
4. Same 5 labels, same order, same colors — homepage, live terminal, webpage report, PDF report
