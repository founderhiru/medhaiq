# Phase 20 — Interview Setup redesign (3-column premium dashboard)

## Layout breakdown (so we're aligned before you deploy)
- **Left sidebar (~250px):** Session Context (live-updates as you make selections — role, experience, interviewer, difficulty), Session Breakdown donut (your finalized 5 vectors), Live Terminal Preview (4 engines "Ready")
- **Center (~55%):** the 3-step wizard — role cards in two tabs (Core / AI & Data), 4 experience-level cards, 6 interviewer persona cards — all with the glowing blue selected-state border + circular ✓ checkmark from the target image
- **Right sidebar (~300px):** Live Terminal — gradient AI Engine ring, STAR progress, score placeholder, 5-Vector list (finalized taxonomy + colors, same as everywhere else), activity feed, and the Initialize Session button (moved here from the old bottom sticky bar, per the target design). Sticky, so it stays visible while you scroll the wizard.
- **Bottom:** full-width 5-item trust bar, same items/colors as your homepage value bar.

## One important correction to your prompt
You asked for React/Tailwind — but your actual stack is EJS + plain CSS
(no React anywhere in your project). React code would have been
unusable. This is built in your real stack, fully self-contained
(all styles embedded in the file, exactly like your current setup page),
so it can't affect any other page.

## What is 100% preserved (verified against your current live file)
- The exact API call: `POST /api/interview/sessions` with
  `{ personaId, roleTitle, experienceLevel, vapiVoiceId }` — unchanged
- All 6 persona IDs and voice IDs (`alex_chen`/`voice-alex`, etc.) — unchanged
- All role values (`Product Manager`, `AI Engineer`, etc.) — unchanged, so
  your backend's role→competency mapping keeps working
- Custom role input flow, tab switching, disabled-until-complete button

## Honest flag: the donut percentages are presentational
The 35/25/20/10/10 breakdown in the left sidebar is a design element
from your target image — as we established in the earlier audit, your
backend currently selects question competencies round-robin, not by
weighted percentages. Displaying it is fine for now (it communicates the
evaluation framework), but know that it describes intent, not an
enforced algorithm. Building the real weighted selector is still on the
table as a separate backend task whenever you want it.

## Deployment — one file
1. Open `views/interview-setup.ejs` on GitHub, click the pencil (edit) icon.
2. Select ALL existing content, delete it.
3. Paste in the entire contents of `interview-setup.ejs` from this delivery.
4. Commit. Wait for Render to redeploy.

## Verify (do the full flow, not just a look)
1. Go to `/interview`, hard refresh
2. Confirm the 3-column layout renders; left context panel starts as "Not selected"
3. Click a role → card gets glowing border + ✓, left panel updates, terminal still says Waiting
4. Click an experience level → same
5. Click an interviewer → left panel shows their name + difficulty; right terminal flips to "Ready"; Initialize Session button lights up
6. **Click Initialize Session and actually run a question or two** — this confirms the API wiring survived the redesign (it should — payload is byte-identical — but always verify the critical path)
7. Try the Custom role: click Custom Role card, type a role, press through the flow
8. Check on your phone too — below 1200px it stacks to one column with the terminal after the wizard

If anything is off, screenshot it and I'll patch precisely.
