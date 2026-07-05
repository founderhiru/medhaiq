# Phase 11 — Compact chips (per TG.jpg) + denser layout + less gutter waste

## Honest expectation-setting first
I can make this noticeably tighter and denser, closer to TG.jpg's compact
feel. I can't promise "zero scrolling on every laptop at 100% zoom" —
screen heights vary too much between devices for any single layout to
guarantee that. What's below gets you meaningfully closer on typical
laptop screens (13"-16", 1080p+) without compromising readability.

## What changed
1. **Chips are compact pills again** — fixed ~152px width, smaller icon,
   smaller text, wraps to 2 lines inside the pill (matches "Continuous
   Growth" wrapping in TG.jpg) — not the big square cards from Phase 10.
2. **Tighter vertical rhythm** — smaller margins under the badge, headline,
   and mini card.
3. **Wider content area on large screens** — the two-column layout now
   uses more of the available width on big monitors, so there's less
   dead empty space on the left/right gutters at 100% zoom.

## Files in this delivery
1. `hero-v2.css` — FULL REPLACEMENT for `public/css/hero-v2.css` (same rule as always — no append steps)
2. 3 small edits in `medhaiq.css` — no file needed, just the diffs below

## Step 1 — Replace hero-v2.css entirely
Open `public/css/hero-v2.css`, select all, delete, paste in the new version, commit.

## Step 2 — 3 small edits in medhaiq.css
Open `public/css/medhaiq.css`, make these 3 changes, commit once at the end:

**Edit A** — find:
```
.mh-hero-badge {
  ...
  margin-bottom: 28px;
}
```
Change `margin-bottom: 28px;` to `margin-bottom: 18px;`

**Edit B** — find:
```
.mh-hero-h1 {
  ...
  margin-bottom: 20px;
}
```
Change `margin-bottom: 20px;` to `margin-bottom: 14px;`

**Edit C** — find (the block you already edited in Phase 10):
```
.mh-hero {
  ...
  padding: 100px 40px 40px;
  ...
}
```
Change `padding: 100px 40px 40px;` to `padding: 80px 32px 32px;`

## Verify
Hard refresh (`Cmd+Shift+R` / `Ctrl+Shift+R`) and check:
1. Chips are small pills again, 2-line text wrap, not big cards
2. Overall hero feels noticeably more compact top-to-bottom
3. Less empty space on the far left/right edges on a wide monitor
4. Logo, nav, CTAs, terminal panel, dot-cloud all still correct

If it's still not tight enough after this, the next lever to pull is
reducing the headline font size itself (currently scales up to 72px on
large screens) — that has more real impact on total height than margins
do, but changes the visual weight of your main heading, so I'd want your
go-ahead before touching that specifically.
