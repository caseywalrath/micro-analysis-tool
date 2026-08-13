# Modern UI Refresh — Master Plan

Status: **in progress** — phases 0–6 complete; phase 7 (shell, accessibility,
documentation, and refreshed baselines) is next. Phase 8 was added after the Phase 6
checkpoint as a post-refresh feature expansion. (2026-08-13)

**2026-08-13 session checkpoint.** Phase 5 removed static inline styles from the 14
active popup fragments in four commits on
`codex/ui-refresh-phase-5-inline-style-purge`. Phase 6 was then completed in commit
`579b2c3` on `codex/ui-refresh-phase-6-demodalize`: analysis panels are non-modal,
dock right over a live map, collapse to their title bar, and Transit Travelshed can pick
an origin without closing its panel. Golden tests passed 129/129 and the visual harness
passed 58/60 captures with the two documented hidden-sidebar skips.

**Feature Attributes follow-up.** In the same Phase 6 working session, the singleton
Feature Attributes popup was aligned with the floating-panel pattern: it docks left on a
fresh open, collapses to its title bar, and places the color and per-feature appearance
controls in a separate left-aligned row below the feature title. This keeps its close and
collapse controls uncluttered while preserving drag behavior.

**Phase 7 scope addition.** After the Phase 6 checkpoint, the developer revisited the
Phase 4 Walkshed narrow-panel pilot in light of the now-live map. Phase 7 now includes a
bounded single-step panel normalization pass before its shell/accessibility work and
final baseline refresh. Feature Area Analysis, Transit Propensity Index, Corridor
Scoring, and the FTA Small Starts Ratings tab will adopt the shared collapsible-input
pattern; Walkshed, Transit Coverage, and Transit Travelshed receive regression checks.
Route Costing and Trip Builder require a narrow-layout fit test and may remain unchanged
if their dense results do not fit. Ridership Forecasting, Title VI, and GTFS are explicitly
excluded because their multi-step or specialized workspaces do not match the schema.

**Phase 8 addition.** During review of Phase 6's floating-panel behavior, the developer
asked whether multiple analysis tools could remain open together. The use case is
side-by-side comparison of tool inputs/results while keeping the map live. This was not
part of the original refresh scope, so it was added after Phase 7 as
`phase-8-multi-analysis-panels.md`; it does not delay completion of the original
phases 0–7.

**Phase 4 checkpoint outcome.** Approved, with a follow-up commit covering the
developer's review notes. Approved as-is: control height, the Route Costing
settings modal, the Walkshed narrow-panel pilot. Changed in the follow-up:
collapsible module inputs (new shared `App.renderModuleInputs`, wired into
Walkshed / Transit Coverage / Transit Travelshed), feature-panel row spacing, the
census-cache note no longer reading as a button, dropdown-menu consistency, and
Feature Area Analysis rebuilt on the Settings | Results schema (part of phase 5's
remit, pulled forward). Deferred by the developer: a separate pass on option
wording throughout.

Two **non-UI fixes** rode the same branch as clearly-labelled separate commits —
they are not part of the refresh and the phase docs claim no credit for them:
registering five missing analysis overlays in the Layers panel, and giving
Walkshed the prompt-to-download street-network flow Transit Travelshed already
had.

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

| Phase | File | What | Visible change? | Checkpoint after? | Status |
|---|---|---|---|---|---|
| 0 | `phase-0-screenshot-harness.md` | Automated popup screenshot capture (light+dark) + baseline set | None | No | ✅ Done |
| 1 | `phase-1-design-tokens.md` | Color/spacing/radius/shadow tokens, dark-mode token block, `accent-color` | Checkboxes/radios only | **Yes — palette approval** | ✅ Done, approved |
| 2 | `phase-2-color-migration.md` | Migrate ~660 hardcoded hex values onto tokens; collapse redundant dark-mode rules | Near-none (tiny consolidation shifts) | **Yes — full screenshot review** | ✅ Done, reviewed |
| 3 | `phase-3-typography-inter.md` | Inter font, scale bump (13→14 base), fix 35 hardcoded px sizes | Everything gets slightly larger | **Yes — type approval** | ✅ Done, approved |
| 4 | `phase-4-controls-refresh.md` | Modern form controls, buttons, checklists; widen settings columns + popups | Large — the headline change | **Yes — key checkpoint** | ✅ Done, approved with changes |
| 5 | `phase-5-inline-style-purge.md` | Replace ~370 static inline styles in popup HTML with shared primitives | Near-none | No | ✅ Done |
| 6 | `phase-6-demodalize.md` | Remove backdrop, live map behind popups, collapse button on popup header | Large behavior change | **Yes — behavior test** | ✅ Done, checkpoint delivered |
| 7 | `phase-7-shell-a11y-docs.md` | Single-step panel normalization, toolbar/menu grouping, focus/aria/target-size pass, docs + new baselines | Moderate–large | Original refresh final review | Planned; expanded 2026-08-13 |
| 8 | `phase-8-multi-analysis-panels.md` | Keep one floating panel per analysis module open; independent focus, drag, collapse, and close | Large behavior/architecture change | **Yes — multi-panel behavior test** | Planned; added 2026-08-13 |

Phases must run **in order**. Phases 2–5 build on the token foundation; phases 6–7
complete the original refresh. Phase 8 begins only after Phase 7 because it changes the
popup architecture and should use the final refreshed shell, accessibility behavior,
and screenshot baselines.

## Rules of engagement (every phase)

- **Never touch calculation code.** No edits to `js/projects/*-scoring.js`, `*-engine.js`,
  `js/core/travelshed.js`, `js/core/census.js`, `js/core/lodes.js` math, or anything the
  golden harness covers. If a phase touches ANY `.js` file (phases 4, 6, 7, and 8 do,
  for UI config only), run `node test/run-golden.mjs` before committing and record
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
   The phase-2, phase-6, and phase-8 checkpoints are "review and continue unless told
   to stop."

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
- **Phase 7 — narrow-panel fit:** collapsible inputs should expose more of the live map,
  but narrowing dense results can make a tool worse. Feature Area Analysis, TPI,
  Corridor Scoring, and FTA Ratings are confirmed conversions. Route Costing and Trip
  Builder are conditional: retain their current layouts unless their widest result states
  pass the explicit fit test in the Phase 7 plan. Do not convert Ridership Forecasting,
  Title VI, or GTFS under this work item.
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
