# Phase 5 — Dark refresh, glassmorphic chips, blinking LIVE, waveform dots

## Files in this delivery (only 2)
1. `hero-v2-phase5-addition.css` — snippet to ADD to the END of your existing `public/css/hero-v2.css`
2. `hero.ejs` — full replacement for `views/partials/hero.ejs`

## Step 1 — Darken the shared background tokens (affects the WHOLE site, one edit)
1. Open `public/css/medhaiq.css`, click the pencil (edit) icon.
2. Use Ctrl+F / Cmd+F in your browser to find this block near the very top:
   ```
   --navy-deep:    #0A0F1E;
   --navy-rich:    #0F172A;
   --navy-card:    #131B2E;
   --navy-border:  #1E293B;
   ```
3. Replace just those 4 lines with:
   ```
   --navy-deep:    #05070D;
   --navy-rich:    #080B14;
   --navy-card:    #0A0E1A;
   --navy-border:  #161F30;
   ```
4. Commit. This is the ONLY edit needed for the darker tone — because every page (homepage, hero, cards, terminal, login) all read their background color from these same 4 values, this one change updates everything at once, consistently.

## Step 2 — Add the Phase 5 CSS
1. Open `public/css/hero-v2.css`, click the pencil (edit) icon.
2. Scroll to the very bottom of the existing content.
3. Click at the end of the last line, press Enter.
4. Paste in the entire contents of `hero-v2-phase5-addition.css` from this delivery.
5. Commit.

## Step 3 — Replace hero.ejs
1. Open `views/partials/hero.ejs`, click the pencil (edit) icon.
2. Select all, delete, paste in the new `hero.ejs` from this delivery.
3. Commit.

## What each part does
- **Darker background** — one shared-token edit (Step 1), cascades everywhere automatically.
- **Chip redesign** — each of the 4 chips now carries its own tinted glass background (purple / green / gold / magenta) instead of all four looking identical; "Continuous Growth" icon changed from blue to magenta as requested.
- **Blinking LIVE dot** — pure CSS animation, breathing opacity + scale, loops forever, respects "reduce motion" accessibility settings automatically.
- **Wider spacing between columns** — the gap between your text column and the terminal panel increased from 48px to 72px (narrows back down automatically on smaller screens so it doesn't break mobile).
- **Waveform dots** — added as a pure CSS effect on an element that already exists in your page (no new markup needed), so this could not have broken anything structurally. Two rows of dots drift slowly left across the hero background at different speeds/opacities for a layered depth effect.

## Verify
Hard refresh (`Cmd+Shift+R` / `Ctrl+Shift+R`) and check:
1. Homepage background is noticeably darker, consistently, if you scroll through other sections too
2. The 4 hero chips each have a distinct subtle color tint
3. The green "Live" dot in the terminal panel pulses continuously
4. Faint moving dots visible drifting across the hero background
5. Logo, nav links, both hero CTAs, and the interview flow all still work exactly as before

## About "MT.jpg"
I built this from your written spec since I didn't receive the image file itself in this message — if you re-send it, I'll do a side-by-side check against the actual mockup and adjust anything that's off (exact hex tone, dot density/speed, spacing) as a small follow-up patch rather than a full redo.
