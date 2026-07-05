# Phase 15 — Fix mobile "dead sideways scroll" bug

## The actual cause
Good news: your terminal panel disappearing on mobile is **intentional
and working correctly** — that's not a bug. The real problem is your
button row:
```
.mh-hero-actions {
  display: flex;
  align-items: center;
  gap: 16px;
  ...
}
```
`display: flex` without `flex-wrap` means "Start Your Free Trial" and
"See How It Works" are forced to sit side-by-side no matter how narrow
the screen gets. On a phone, they don't fit — "See How It Works" gets
pushed past the right edge of the screen, which makes the ENTIRE PAGE
slightly wider than the phone's viewport. That's exactly the "dead
sideways scroll with nothing there" feeling — you're not scrolling to
reach real content, you're scrolling to reach the clipped edge of a
button that doesn't fit.

## The fix — one small addition, in the mobile section of medhaiq.css
1. Open `public/css/medhaiq.css`.
2. Find the `@media (max-width: 768px) {` block (search for it — it's
   the one you can see already has other mobile-only rules like
   `.mh-footer-inner { flex-direction: column; ... }`).
3. Add this new rule anywhere inside that block, e.g. right after
   `.mh-footer-inner { flex-direction: column; gap: 16px; text-align: center; }`:
   ```
   .mh-hero-actions {
     flex-wrap: wrap;
   }
   .mh-hero-actions .mh-btn-primary,
   .mh-hero-actions .mh-btn-outline {
     width: 100%;
     justify-content: center;
   }
   ```
4. Commit.

This makes both buttons stack full-width on top of each other on phone
screens (a very standard, expected mobile pattern) instead of squeezing
side-by-side and overflowing.

## One more small thing I noticed (not a bug, just worth a decision)
In your value bar on mobile, "Role-Specific Interviews" shows a subtitle
of "Interviews" right underneath — which repeats the word already in
the title, and reads a little redundant. This was in the original
content, not something introduced by any of our fixes, so it's your
call rather than something I should silently change. Want me to remove
that specific subtitle, or leave it as-is?

## Verify
Hard refresh on your phone (or pull-to-refresh in Safari/Chrome) and
check:
1. No more sideways scroll/drag on the homepage at all
2. "Start Your Free Trial" and "See How It Works" stack as two full-width
   buttons, one above the other
3. Everything else (chips, value bar, trust bar logos) still looks the
   same as your screenshots above, which were already correct
