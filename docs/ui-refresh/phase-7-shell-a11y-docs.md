# Phase 7 — Shell hierarchy, accessibility, documentation

**Goal:** the remaining moderate wins — toolbar grouping, Analysis menu grouping, an
accessibility pass — then update the project docs and refresh the screenshot baselines
to the new look.

## 0. Consider fixing the dark-mode no-flash bug here

Phase 0 found that `index.html`'s "no-flash" `<head>` script reads
`document.body.classList` before `<body>` exists, so it throws on every load
(a real `pageerror`, not a sandboxed-environment artifact) and never applies
the class — dark mode currently reverts to light on every reload for real
users, only surviving via the `#darkmode-btn` click handler for the rest of
the tab session. See the README's known-risk register for the full writeup.
This phase already relocates that button, so it's a natural place to also fix
it: move the one-line script from just before `</head>` to the first line
inside `<body>` (still runs before any other body content paints — same
no-flash effect — but `document.body` exists there). Not required, but flag
the decision to the developer rather than leaving it silently broken. **If
fixed, update `capture.mjs` too**: it unconditionally clicks `#darkmode-btn`
for the dark pass today because that's the only thing that currently works;
once the no-flash script correctly pre-applies the class, that same click
would toggle dark mode back *off* instead. Guard it — only click when
`!document.body.classList.contains("dark-mode")`.

## 1. Toolbar hierarchy

Today `#file-actions` mixes view toggles (dark mode, present) with workflow actions
(save, add data, export, analysis). Restructure `index.html` (keep all ids; only move
elements and adjust CSS):

- **Left group — session/workflow:** save-state, add-data, export, analysis.
- **Center — draw tools** (unchanged) then draw actions (undo/redo/clear), with the
  destructive **Reset** kept at the group's far end with its existing extra margin.
- **Right group — view controls:** dark-mode and present buttons, placed immediately
  left of the search box (`#search-wrapper` is absolutely positioned right — put the
  view buttons in a small absolutely-positioned wrapper beside it, or convert the
  toolbar's right side to a flex group; implementer's choice, but don't break the
  search dropdown positioning).
- Add subtle group separators: `1px` `var(--border)` vertical rules with
  `var(--space-3)` gaps (replace the current bare `margin-right: 32px` /
  `margin-left: 32px`).

Check present-mode and collapsed states still look right (present mode hides the
toolbar entirely — unaffected, but verify).

## 2. Analysis dropdown grouping

In `js/app.js` `buildAnalysisButtonsHTML()`: render two labeled groups using the same
heading style as the Add Data dropdown (`.add-data-heading` pattern):

- **General:** Buffer-Area Summary, GTFS Feed Viewer, Title VI Service Equity.
- **Transit:** Transit Propensity, Transit Coverage, Transit Travelshed, Walkshed,
  Corridor Scoring, Ridership Forecasting, Route Costing, Trip Builder, FTA Small
  Starts.

Implementation note: modules register in script order; hardcode the two id lists in
`buildAnalysisButtonsHTML` with a fallback bucket ("Other") for any registered module
not in either list (so future modules never vanish). Skip `system: true` modules as
today. JS UI change → run golden harness.

## 3. Accessibility pass

- **Focus visibility:** add a global
  `:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }`
  and remove any `outline: none` that isn't paired with a box-shadow focus style
  (grep `outline`).
- **Labels:** every icon-only button gets `aria-label` (grep `<button` in `index.html`
  and the JS-built row buttons in `features.js` / `layers-panel.js`: gear, trash, eye,
  color swatch, duplicate, collapse chevrons). `title` alone is not enough.
- **Target size:** the small row icons (`.fp-gear-btn`, `.fp-del-btn`, layer-row
  icons, `.rf-info-btn`) get a ≥24×24px hit area via padding/min-sizes — visual glyph
  size can stay as-is.
- **Color-alone check:** classification pills already carry text (High/Medium/Low) —
  confirm; the red "blocked service" rows in Route Costing / Trip Builder already have
  ⚠ badges — confirm; fix any case found where color is the only signal.

## 4. Documentation + wrap-up

- **CLAUDE.md:** update the Conventions section — semantic color tokens + the dark-mode
  token block (declare "no raw hex for chrome colors; data colors exempt"), spacing
  scale, the shared control classes and layout primitives (`.form-field`,
  `.form-section`, `.btn-row`, `.u-*`), Inter, de-modalized popup behavior (live map,
  dock-right, collapse), and the screenshot harness (`test/ui-screens/`) as the visual
  verification tool.
- **CLAUDE.md — correct the stale sidebar description** (phase 0 finding): the
  "Panel-based sidebar" Conventions bullet and the Layout section's ASCII
  diagram both describe `#sidebar-wrap` / the Analysis panel as if live, but
  `App.sidebar.render()` is never called anywhere and the Analysis panel is
  actually the toolbar dropdown built by `buildAnalysisButtonsHTML()`. If §1's
  toolbar work or phase 4 didn't revive the sidebar, update both spots (plus
  the `sidebar.js` file-structure entry) to say so plainly instead of
  describing dead code as current behavior; if it *was* revived along the way,
  update to match whatever it now does.
- **features.md:** mark "Modern UI refresh" done (link to `docs/ui-refresh/`), and note
  that "Analysis dropdown navigation" and "Top menu layout and hierarchy" were partially
  delivered here (grouping + toolbar hierarchy); leave the vertical icon rail and
  command palette items open.
- **Refresh baselines:** rerun the capture script; replace `test/ui-screens/baseline/`
  with the new-look images (delete the pre-refresh set — git history keeps it).

## Verification

- Capture script both themes — final full pass.
- `node test/run-golden.mjs` → pass.
- Keyboard-only walkthrough: Tab through toolbar → sidebar → a popup; focus always
  visible; Escape closes popup.

## Final review

Send the developer the final light+dark shell and 3–4 popup screenshots plus a summary
of everything shipped across phases 0–7, and the list of deliberately-deferred items
(vertical icon rail, command palette, JS-template inline styles, docked-panel popup
variant).

Commit: `UI refresh phase 7: toolbar/menu hierarchy, a11y pass, docs, new baselines`
(with `Verified: node test/run-golden.mjs → N/N`)
