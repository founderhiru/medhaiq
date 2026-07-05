# Phase 8 — Consolidation + 3 fixes

## Why a consolidated file this time
Issue #2 (dot-cloud disappearing) most likely happened because of paste
ORDER inside hero-v2.css across several earlier messages — a classic risk
with "append this snippet" instructions repeated many times. Instead of
another snippet, this delivery gives you ONE complete, final hero-v2.css.
From now on, hero-related CSS changes will always be a full-file
replacement of this same file — no more append steps, no more ordering
ambiguity.

## Files in this delivery (3)
1. `hero-v2.css` — FULL REPLACEMENT for `public/css/hero-v2.css`
2. `hero.ejs` — FULL REPLACEMENT for `views/partials/hero.ejs` (only the AI Engine ring markup changed — now a complete filled ring instead of a partial arc)
3. This README (medhaiq.css fix is a single line, explained below — no file needed)

## Step 1 — Replace hero-v2.css entirely
1. Open `public/css/hero-v2.css` on GitHub, click the pencil (edit) icon.
2. Select ALL existing content, delete it.
3. Paste in the entire contents of the new `hero-v2.css` from this delivery.
4. Commit.

## Step 2 — Replace hero.ejs
1. Open `views/partials/hero.ejs`, click the pencil (edit) icon.
2. Select all, delete, paste in the new `hero.ejs` from this delivery.
3. Commit.

## Step 3 — Fix the gap: one line in medhaiq.css
1. Open `public/css/medhaiq.css`, click the pencil (edit) icon.
2. Ctrl+F / Cmd+F to find this block:
   ```
   .mh-hero {
     position: relative;
     min-height: 100vh;
     display: flex;
     align-items: center;
     overflow: hidden;
     padding: 120px 40px 80px;
     background: var(--navy-deep);
   }
   ```
3. Change the line `min-height: 100vh;` to `min-height: auto;`
4. Commit.

This makes the hero section only as tall as its actual content (plus its
padding), so the value bar sits directly underneath it — no more dead
black gap, on any screen size.

## Verify
Hard refresh (`Cmd+Shift+R` / `Ctrl+Shift+R`) and check:
1. The value bar (AI Personalization, etc.) now appears immediately after the hero content, no big gap
2. The soft blue-to-purple dot cloud is back, drifting gently between the two hero columns
3. The AI Engine "Ready" circle is now a complete, fully-colored gradient ring — no gap/arc
4. Logo, nav, both CTAs, chips, mini card, terminal panel — all still exactly as before
