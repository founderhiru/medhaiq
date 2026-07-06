# Phase 16 — Remove bullets, match font sizes, dot-cloud check

## Files in this delivery (2 full files + 2 small edits)
1. `hero-v2.css` — FULL REPLACEMENT for `public/css/hero-v2.css` (consolidates everything to date: Phase 8 base, Phase 12's flattened chip borders, Phase 14's squeeze-zone compacting — the dot-cloud graphic is confirmed present in this file)
2. `value-footer.css` — FULL REPLACEMENT for `public/css/value-footer.css` (fonts now match the chip sizes: 12.5px title, matching your compact chips in CTA.jpg, 11px sub)
3. 2 small edits to `medhaiq.css`, below

## Step 1 — Replace hero-v2.css entirely
Open `public/css/hero-v2.css`, select all, delete, paste in the new version, commit.
*(This also re-confirms the dot-cloud graphic from Phase 6 — if you weren't seeing it, this should restore it. See the note at the bottom about the "red circled" reference.)*

## Step 2 — Replace value-footer.css entirely
Open `public/css/value-footer.css`, select all, delete, paste in the new version, commit.

## Step 3 — Remove the bullet dots (CT.jpg), 2 edits in medhaiq.css
This is the `•` separator between "Role-Specific Interviews," "Adaptive AI Assessments," and "Career Intelligence Reports."

**Edit A** — find:
```
.mh-hero-proof {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  margin-top: -10px; /* Pulls the bullets closer to the buttons */
}
```
Change `gap: 16px;` to `gap: 24px;` (this replaces the visual separation the bullet used to provide, so the three items still read as distinct without looking cramped once the dot is gone).

**Edit B** — find:
```
.mh-proof-sep {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--text-faint);
}
```
Add one line so it reads:
```
.mh-proof-sep {
  display: none;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--text-faint);
}
```
Commit both edits together.

*Why `display: none` instead of deleting the rule or editing `hero.ejs`:*
the bullet is a tiny empty `<div>` already sitting in `hero.ejs` — hiding
it via CSS means zero risk to the file structure, and if you ever want
the dot back, it's a one-word undo.

## About the dot-wave graphic (your #3)
I want to flag this honestly rather than guess: you referenced a "red
circled area" in TG.jpg, but the TG.jpg you sent earlier only had
**yellow** circles, and it wasn't re-attached to this message. I've
confirmed the dot-cloud CSS from Phase 6 is present and unchanged in
the file above — but if there's a specific version with a red
annotation showing something different from what's currently live,
please re-send it and point to what should change. I don't want to
rebuild that graphic blind and risk moving it further from what you
actually want.

## Verify
Hard refresh (`Cmd+Shift+R` / `Ctrl+Shift+R`) and check:
1. No more bullet dots between "Role-Specific Interviews / Adaptive AI Assessments / Career Intelligence Reports"
2. Value bar text (AI Personalization, etc.) is now visibly smaller, matching the chip text size above it
3. Dot-cloud graphic still drifting between the two hero columns
4. Nothing else changed — logo, nav, CTAs, terminal, chips all as before
