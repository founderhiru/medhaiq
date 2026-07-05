# MedhaIQ Component Library — Phase 1

## What's in this folder
- `css/components.css` — 12 reusable style blocks (Button, Badge, Card, Section, Live Terminal, AI Score, Question Card, Video Card, Input Box, Mission Footer, Stat Card, Timeline)
- `views/partials/components/button.ejs`, `badge.ejs`, `card.ejs`, `stat-card.ejs` — example reusable EJS snippets that use those styles

## How to install (copy-paste, no local setup needed)
1. Go to your GitHub repo in the browser.
2. Navigate to `public/css/`. Click **Add file → Create new file**.
3. Name it `components.css`, paste in the contents of `css/components.css` from this folder, commit.
4. Navigate to `views/partials/`. Create a new folder by typing `components/button.ejs` as the filename (GitHub auto-creates the folder). Paste in `button.ejs`. Repeat for `badge.ejs`, `card.ejs`, `stat-card.ejs`.
5. Open `views/layout.ejs`. Find this line:
   ```
   <link rel="stylesheet" href="/css/medhaiq.css">
   ```
   Add a new line right after it:
   ```
   <link rel="stylesheet" href="/css/components.css">
   ```
6. Do the same in `views/interview-setup.ejs` (find its `<head>`, add the same line after its existing stylesheet link).
7. Commit, wait for your host (Render) to redeploy, refresh your live site. Nothing should visually change yet — you've only added new tools, not used them anywhere.

## How you'll actually use a component going forward
Anywhere in any `.ejs` file, instead of writing a full `<button>` with inline styles, write:
```ejs
<%- include('partials/components/button', {
  label: 'Start AI Interview',
  href: '/interview',
  variant: 'primary',
  iconRight: true
}) %>
```
Change the button's look ONCE in `components.css` (e.g. make it more rounded) and every button on every page updates.

## What I have NOT touched yet
Your homepage (`layout.ejs` + its 19 partials) and `interview-setup.ejs` still use their old, page-specific CSS from `medhaiq.css` and `interview.css`. This phase only builds the shared toolbox — it doesn't rewire the existing pages to use it yet, so **nothing on your live site changes or breaks from this step alone.**

## Next phases (I'll do these one at a time, in order, so you can verify nothing breaks between each)
1. ✅ Phase 1 — Component library built (this delivery)
2. Phase 2 — Delete the dead/duplicate files (list given above), one at a time
3. Phase 3 — Rebuild `views/partials/hero.ejs` to match the Image 1 mockup (headline + live terminal preview side-by-side), using the new components
4. Phase 4 — Redesign `views/interview-setup.ejs` to match T1/T2: merge duplicate role-selection and experience-level info into one flow, add the right-hand "AI Session Blueprint" + donut chart + "Mission Ready" footer bar, remove the info that's currently repeated between the left form and right panel
5. Phase 5 — Sweep remaining homepage partials (features, timeline, pricing, etc.) to use `.card`, `.section`, `.badge`, `.btn` instead of their one-off classes

Tell me when you've deployed Phase 1 successfully (or if anything looks off) and I'll generate Phase 2/3 as the next copy-paste batch.
