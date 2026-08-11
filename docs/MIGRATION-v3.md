# MedhaIQ Brand System Migration — v3 (Fixed Asset)

## What changed from the last round
Per your instruction, the icon is now a **fixed image asset** — cropped directly
from your uploaded reference and chroma-keyed to a transparent PNG. Nothing is
redrawn, approximated, or built from SVG paths. If your designer later supplies
a proper high-res export (ideally SVG, or a 2x/3x PNG), it's a **single file
swap** at `public/assets/branding/medhaiq-icon.png` — every include of
`brand-logo.ejs` updates automatically, no markup changes needed anywhere.

## Folder structure
```
public/
  assets/
    branding/
      medhaiq-icon.png     # the real cropped+keyed asset (245x167 native)
views/
  partials/
    brand-logo.ejs          # <MedhaIQLogo/> — the ONLY branding component
brand-tokens-v3.patch.css   # tokens + component CSS, paste into :root
```

## Component API (delivered as EJS locals, since there's no JSX here)
```ejs
<%- include('partials/brand-logo', { size: 'md', variant: 'full', href: '/', eager: true }) %>
```
| Prop | Values | Default |
|---|---|---|
| `size` | `xs`(24) `sm`(28) `md`(36) `lg`(44) `xl`(56) | `md` |
| `variant` | `icon` \| `full` | `full` |
| `href` | any path | `/` |
| `suffix` | e.g. `.ai` | `''` |
| `eager` | `true`/`false` — set `true` for the nav (above the fold) | `false` |

Width always auto-derives from the icon's real aspect ratio (245:167) — never stretched, never cropped, per your spec.

Mobile: wordmark auto-hides under 640px via CSS (`.brand-logo--full .brand-logo__wordmark { display:none }`), independent of the `variant` prop, so you get the same "icon-only on mobile" behavior without having to pass a different variant server-side per breakpoint.

## Real locations found in the repo (audited, not assumed)

| Location | File | Current state | Action |
|---|---|---|---|
| Desktop + mobile navbar | `views/partials/header.ejs` (lines 4–16) | Old ribbon-M SVG + text | Replace with `<%- include('partials/brand-logo', { size:'md', eager:true }) %>` |
| Footer brand column | `views/partials/footer.ejs` (line 9) | Plain text span, no icon | Replace with `<%- include('partials/brand-logo', { size:'sm' }) %>` |
| **Interview session top bar** | `views/interview-session.ejs` (lines 35–42) | **A third, independent copy** of the old ribbon-M SVG + text, never mentioned until this audit | Replace with `<%- include('partials/brand-logo', { size:'sm', suffix:'.live' }) %>` — note this page uses "MedhaIQ.live" not ".ai", so `suffix` needs to be passed per-instance |
| Favicon / apple-touch-icon / manifest | `views/layout.ejs` (lines 8–11, inline data-URI SVGs) | Old mark, hand-encoded inline | Point to a real file instead: `<link rel="icon" href="/assets/branding/medhaiq-icon.png">` (PNG favicons work in all current browsers; a proper multi-size `.ico`/SVG can follow once you have a vector export) |
| OG image | `views/layout.ejs` `og:image` meta | External hosted raster on R2 | Out of scope for a code change — needs a new 1200×630 export uploaded to that same host |
| Dashboard / session history | `views/dashboard-history.ejs` | **No logo currently present** | Optional addition, not a swap |
| Interview setup | `views/interview-setup.ejs` | **No logo currently present** (only an unrelated old-style SVG icon used for a UI button, not branding) | Optional addition, not a swap |
| Interview report | `views/interview-report.ejs` | **No logo currently present** | Optional addition, not a swap |
| Error page | `views/error-boundary.ejs` | **No logo currently present** | Optional addition, not a swap |
| PDF export | `views/interview-report-pdf.ejs` / `services/pdf-report.js` | No logo | Renders via Puppeteer, so `brand-logo.ejs` can be included directly — the PNG and gradient text both render correctly in Chromium |
| Founder/admin dashboard | `public/admin/founder-dashboard.html` | No logo, and it's plain HTML not EJS | Can't `include()` a partial here — would need the `<a class="brand-logo">...</a>` markup pasted literally, or converting this file to EJS (bigger change, flagging rather than doing silently) |
| Sidebar / workspace header / email verification / password reset / loading screen / empty states | — | **None of these exist as distinct views in this repo** | Nothing to migrate; flagging so the checklist doesn't silently imply work was done that wasn't |
| Emails | — | No email templates in this repo | Out of scope, as noted last round |

## Tokens
All new values (gradient stops, gap, size scale) live in `brand-tokens-v3.patch.css`. No component references a hardcoded hex or px value — everything reads from `var(--brand-*)`.

## Zero breaking changes
- Old `.mh-logo`, `.mh-logo-text`, `.tb-brand-lockup`, `.mh-footer-logo` classes are left in the CSS untouched — nothing currently depending on them breaks.
- `brand-logo.ejs` is new/additive; nothing is deleted until you approve swapping each of the three real instances above.
- No JS, routes, auth, or layout spacing touched.

## Before I touch any live file
This is still proposal-stage per your approval-gate process. Confirm:
1. OK to replace the 3 real instances (`header.ejs`, `footer.ejs`, `interview-session.ejs`) with `brand-logo.ejs`?
2. OK with the current PNG (cropped from your screenshot) as the interim asset, swapped later for a proper designer export?
3. Want me to also add a logo to the 4 pages that currently have none (dashboard-history, interview-setup, interview-report, error-boundary), or leave those blank for now?
