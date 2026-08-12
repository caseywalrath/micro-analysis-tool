# Modern UI Refresh — Master Plan

Status: **approved, ready to implement** (2026-08-12)

This directory is the implementation plan for the `features.md` item "Modern UI refresh."
It is written to be executed **phase by phase, by separate agent sessions**, each working
from its own phase file. Read this README fully before starting any phase.

## Approved design decisions (do not re-litigate)

These were decided with the developer and are settled:

1. **De-modalize analysis popups.** The dimmed backdrop goes away; the map stays visible
   and interactive while a module popup is open. Popups become draggable floating panels.
2. **Full-notch sizing ("more modern").** Body text moves 13px → 14px; form controls get
   14px text and ~34px height. Dense tables deliberately stay one step smaller.
3. **Inter** becomes the single app-wide font (replacing `system-ui` for UI and
   Open Sans for map labels).
4. **Foundation first.** Design tokens land before any visible polish, so polish is
   written once, in tokens.
5. **No frameworks, no build step.** Tokens + hand CSS only. This is non-negotiable —
   it preserves the project's "anyone can read the source" convention.

## Phase sequence

| Phase | File | What | Visible change? | Checkpoint after? |
|---|---|---|---|---|
| 0 | `phase-0-screenshot-harness.md` | Automated popup screenshot capture (light+dark) + baseline set | None | No |
| 1 | `phase-1-design-tokens.md` | Color/spacing/radius/shadow tokens, dark-mode token block, `accent-color` | Checkboxes/radios only | **Yes — palette approval** |
| 2 | `phase-2-color-migration.md` | Migrate ~660 hardcoded hex values onto tokens; collapse redundant dark-mode rules | Near-none (tiny consolidation shifts) | **Yes — full screenshot review** |
| 3 | `phase-3-typography-inter.md` | Inter font, scale bump (13→14 base), fix 35 hardcoded px sizes | Everything gets slightly larger | **Yes — type approval** |
| 4 | `phase-4-controls-refresh.md` | Modern form controls, buttons, checklists; widen settings columns + popups | Large — the headline change | **Yes — key checkpoint** |
| 5 | `phase-5-inline-style-purge.md` | Replace ~370 static inline styles in popup HTML with shared primitives | Near-none | No |
| 6 | `phase-6-demodalize.md` | Remove backdrop, live map behind popups, collapse button on popup header | Large behavior change | **Yes — behavior test** |
| 7 | `phase-7-shell-a11y-docs.md` | Toolbar grouping, Analysis dropdown grouping, focus/aria/target-size pass, CLAUDE.md + features.md updates | Moderate | Final review |

Phases must run **in order** (2 depends on 1; 3–5 assume 2's tokens; 6–7 are independent
of each other but come last so their screenshots reflect the new look).

## Rules of engagement (every phase)

- **Never touch calculation code.** No edits to `js/projects/*-scoring.js`, `*-engine.js`,
  `js/core/travelshed.js`, `js/core/census.js`, `js/core/lodes.js` math, or anything the
  golden harness covers. If a phase touches ANY `.js` file (phases 4, 6, 7 do, for UI
  config only), run `node test/run-golden.mjs` before committing and record
  `Verified: node test/run-golden.mjs → N/N` in the commit message. It must pass
  untouched — a failure means you changed something you shouldn't have.
- **One phase = one commit** (phase 2 and 5 allow one commit per slice), message format:
  `UI refresh phase N: <summary>`. Push to the working branch after each phase.
- **Verify with screenshots.** Every phase ends by re-running the phase-0 capture script
  and eyeballing each image against the baseline (and against the phase's stated intent).
  Anything unexpected: fix or document in the commit message — never leave it silent.
- **Do not rename the shared `.rf-` classes.** CLAUDE.md explicitly marks
  `.rf-status*`, `.rf-info-box`, and friends as intentionally shared cross-module
  classes. We restyle them in place; renaming would touch dozens of JS string templates
  for zero user benefit.
- **Data colors are not chrome colors.** Feature colors, choropleth ramps, pill
  rating colors (`.pill.high`…`.pill.low`), legend swatches, and per-tool icon colors are
  *data encodings* — leave their hex values alone in every phase.
- **Dark mode is a first-class citizen.** Every visual check happens in both themes.

## Developer checkpoints

At each checkpoint marked above, the implementing agent should:
1. Push the phase commit.
2. Send the developer the relevant before/after screenshots (a handful of representative
   ones, not all ~30 — always include Transit Coverage light+dark as the reference popup,
   plus whatever the phase most affects).
3. Summarize in plain language what changed and anything that surprised it.
4. **Wait for approval before the next phase** at the phase-1, phase-3, and phase-4
   checkpoints (these set the palette, type, and control look everything else inherits).
   The phase-2 and phase-6 checkpoints are "review and continue unless told to stop."

## Verification protocol

Phase 0 builds `test/ui-screens/capture.mjs`. From then on:

```
node test/ui-screens/capture.mjs            # writes test/ui-screens/out/<theme>_<name>.png
```

Baseline images from phase 0 are kept in `test/ui-screens/baseline/` (committed once,
~30 small PNGs) so any later session can diff against the pre-refresh look. After the
refresh ships, the baseline set is refreshed to the new look and the old set deleted.

## Known-risk register (watch for these)

- **Phase 2:** a dark-mode rule deleted too eagerly (rule: delete only when *every*
  declaration in it is made redundant by a token). Symptom: light-colored text/bg
  appearing in dark mode.
- **Phase 3/4:** dense tables (Route Costing, Trip Builder, Attribute Summary) and the
  CSS grid column templates (`.as-grid-*`) overflowing after the size bump. Both phases
  include explicit retuning steps — don't skip them.
- **Phase 4:** the 240→280px settings column + wider popups can push 2-column popups past
  `max-width: 90vw` on small windows; the existing responsive stack rule at
  `style.css` (`@media` near `.tpi-popup-layout`) should be checked still fires.
- **Phase 6:** flows that arm a one-shot map click while the popup is open (Transit
  Travelshed "Pick origin on map") change feel when the map is live — test that flow
  end-to-end.
- **Phase 4 — dead sidebar:** phase 0 confirmed `#sidebar-wrap` ships
  `display:none` in `index.html` and nothing in the codebase ever calls
  `App.sidebar.render()` to reveal it — the left "Data Inputs" sidebar is
  unreachable dead code (superseded by the buffer-summary popup and the toolbar
  Analysis dropdown). Phase 4 §1 and §4 plan to restyle `sidebar-v2.css`
  controls/checklists anyway; that's not wrong (tokens should cover it either
  way if it's ever revived) but don't burn checkpoint time screenshotting
  something no user can see, and flag to the developer whether to leave it
  dead, style it on spec, or use phase 7's toolbar pass to revive it.
- **Phase 7 — dark mode doesn't persist across reload:** phase 0 found that
  `index.html`'s "no-flash" `<head>` script
  (`if (localStorage.getItem("mat-dark-mode")==="1") document.body.classList.add(...)`)
  runs while the parser is still inside `<head>`, so `document.body` is `null`
  and it throws every time (confirmed via a real `pageerror` during phase 0's
  dark captures). Pre-seeded `localStorage` therefore never applies on first
  paint — a real, pre-existing bug, not something this refresh introduces.
  Dark mode currently only takes effect for the rest of the current tab
  session, via the `#darkmode-btn` click handler (`app.js`), and reverts to
  light on every reload. The screenshot harness already works around this by
  clicking the real button instead of relying on the pre-seed (see
  `test/ui-screens/capture.mjs`), so it doesn't block any phase's
  verification — only real users are affected. Phase 7 already touches this
  button's toolbar placement; consider fixing it there. Minimal fix: relocate
  that one `<script>` line from just before `</head>` to the first line inside
  `<body>` — same no-flash effect (still runs before any other body content
  paints), but `document.body` exists by then. (Swapping to
  `document.documentElement.classList` instead would NOT be a drop-in fix —
  every dark-mode rule in `style.css` is keyed off `body.dark-mode …`, so that
  approach would require re-keying the whole stylesheet.)
