# Phase 10 — Card-style chips + tighter overall spacing

## What changed
1. **Chips redesigned as solid cards** — same background/border treatment as your terminal panel and trust bar (`var(--navy-card)` solid fill, not a translucent pill), arranged in a clean 2x2 grid instead of wrapping pills.
2. **Tighter vertical rhythm** — reduced a few oversized margins (28→24px, 32→24px) so the hero reads as one cohesive block instead of separately-spaced pieces.
3. **Remaining gap before the value bar** — one more small padding reduction below.

## Files in this delivery (1 full file + 2 tiny edits)
1. `hero-v2.css` — FULL REPLACEMENT for `public/css/hero-v2.css` (same "always full-file" rule as Phase 8 — no append steps)

## Step 1 — Replace hero-v2.css entirely
Open `public/css/hero-v2.css`, select all, delete, paste in the new version, commit.

## Step 2 — Trim the remaining gap in medhaiq.css
1. Open `public/css/medhaiq.css`, find this block (should be around line 281 — you already edited `min-height` here in Phase 8, so it should currently read `auto`):
   ```
   .mh-hero {
     position: relative;
     min-height: auto;
     display: flex;
     align-items: center;
     overflow: hidden;
     padding: 120px 40px 80px;
     background: var(--navy-deep);
   }
   ```
2. Change `padding: 120px 40px 80px;` to `padding: 100px 40px 40px;`
3. Commit.

## Step 3 — Trim value-footer padding to match
1. Open `public/css/value-footer.css`, find:
   ```
   .mh-value-footer-inner {
     max-width: var(--max-w);
     margin: 0 auto;
     padding: 28px 40px;
     ...
   ```
2. Change `padding: 28px 40px;` to `padding: 20px 40px;`
3. Commit.

## Verify
Hard refresh (`Cmd+Shift+R` / `Ctrl+Shift+R`) and check:
1. The 4 feature items now look like solid, bordered cards (2 per row) matching the visual weight of the terminal panel — not thin outlined pills
2. Noticeably less dead space between the mini card and the value bar below it
3. Overall hero feels a bit more compact/cohesive top to bottom
4. Nothing else (logo, nav, CTAs, terminal panel, dot-cloud) changed

If the gap is still wider than you'd like after this, send one more screenshot and I'll take another pass at the padding numbers specifically — spacing is one of those things that's genuinely faster to dial in with 1-2 more rounds of "a little more/less" than to guess perfectly up front.
