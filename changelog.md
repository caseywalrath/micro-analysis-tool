# Changelog

Running log of changes to micro-analysis-tool. Each session should append entries here.

---

## 2026-02-11 — Initial commit & code review

- Received single-file `index.html` (1,865 lines) — a ChatGPT-generated FTA Small Starts Land Use screening tool
- Created `REVIEW.md` with a full code review identifying 7 bugs and structural issues
- Created `plan.md` outlining a 4-phase modularization strategy

## 2026-02-11 — Phase 1: File extraction (no behavior change)

Decomposed the monolithic `index.html` into a modular file structure. All functionality preserved; no logic changes.

**Files created:**
- `css/style.css` — extracted all CSS
- `js/core/utils.js` — CSV parsing, number formatting, GEOID normalization, VAR_META
- `js/core/map.js` — MapLibre GL map initialization
- `js/core/stations.js` — station points, buffers, union polygon, map layers
- `js/core/census.js` — TIGERweb geometry queries, ACS data fetch, area-weighted aggregation
- `js/core/lodes.js` — LODES download/upload/parse, block-level employment
- `js/projects/fta-small-starts.js` — FTA breakpoint classification, CRE/ESS/LBAR logic
- `projects/fta-small-starts.html` — FTA sidebar HTML fragment
- `js/app.js` — startup wiring, summary runners, event bindings
- `index.html` — rewritten as a thin shell (~155 lines) with script tags

## 2026-02-12 — Phase 2: Project interface (`registerProject`)

Formalized how projects plug into the core via `App.registerProject()`.

**Changes:**
- `js/app.js` — added `registerProject(config)` function that fetches a project's HTML fragment, injects it into `#project-panel`, and calls `init(core)`. Core events (station changes, summary runs, LODES loads) now call `update(core)` on the active project
- `js/app.js` — built the `core` object providing projects with access to shared state and functions (`stations`, `buffers`, `map`, `getUnion`, `fetchTigerwebGeos`, `computeAcsValueOnly`, `utils`, etc.)
- `js/projects/fta-small-starts.js` — restructured as an `App.registerProject({...})` call with `init()` and `update()` hooks. All FTA-specific state remains in the closure
- Core app works independently when no project script is loaded

## 2026-02-12 — Phase 3: Bug fixes from REVIEW.md

All 6 bugs addressed (Bug #5 — Census API key — excluded as it requires an external credential).

- [x] **Bug #1 — TIGERweb pagination:** Added `fetchAllTigerwebFeatures()` in census.js that loops with `resultOffset`/`resultRecordCount` until `exceededTransferLimit` is false. Used by both `fetchTigerwebGeos` and `fetchBlocksInternalPointsInUnion`.
- [x] **Bug #2 — Breakpoint range gaps:** Changed `classify()` to use `>= min` only (sorted high-to-low, first match wins). Removed fragile max bounds and epsilon hacks. Values like 4.5 for essential services now correctly classify instead of returning "N/A".
- [x] **Bug #3 — Race conditions:** Added `_bpRunning`/`_bpQueued` concurrency guard around `updateBreakpointRatings()`. Overlapping calls coalesced into a single queued re-run.
- [x] **Bug #4 — LODES gzip assumption:** Checks gzip magic bytes (`0x1f 0x8b`) before decompressing. Falls back to `TextDecoder` for plain CSV uploads.
- [x] **Bug #6 — County FIPS debounce:** 500ms `setTimeout`/`clearTimeout` debounce on the county FIPS input listener.
- [x] **Bug #7 — turf.intersect throws:** Wrapped in `try/catch` at both call sites (`aggregateWithinUnion` in census.js, `computeCommunityRiskFromCre` in fta-small-starts.js). Individual failures skip instead of aborting all aggregation.

## 2026-02-12 — Phase 4: Documentation

- Created `CLAUDE.md` — consolidated from `architecture.md`; primary onboarding doc for Claude Code sessions. Covers file structure, App namespace API, project system, sidebar layout, known issues.
- Wrote `README.md` — user-facing overview: what the tool does, quick start, how to add projects, external dependencies.
- Added `Exports:` lines to all 7 JS file headers listing their public API.
- Updated `changelog.md` (this file) with Phase 3 and Phase 4 entries.
- Removed `architecture.md` (content moved to `CLAUDE.md`).

---

## 2026-02-13 — UI cleanup and feature-panel enhancements

### Removed Study Area / Status card
- Removed the `<h3>Study Area</h3>` heading, the Status card (`#status` span, `#lineDrawing` div), and the `<hr>` separator from the sidebar in `index.html`
- Guarded `setStatus()` in `utils.js` so it silently no-ops when the `#status` element is absent

### Separated station placement from buffer drawing
Stations and buffers are now independent. Clicking the map in Station mode places only a point marker — no buffer is drawn automatically.

**New UI:** A **Buffer** row in the Features panel (right sidebar), directly below the Stations list, with a numeric radius input (in miles) and "mi" label. Default value is `0` (no buffers).

**Behavior:**
- Radius `0` → no buffers drawn; station points remain visible
- Radius `> 0` → circular buffers drawn around all stations at that radius; changing the value live-updates all buffers
- Summary runners now distinguish "no stations" from "no buffers (radius = 0)" and guide the user accordingly

**Files changed:**
- `js/core/stations.js` — `addStationPoint()` no longer auto-creates buffers; new `rebuildBuffers(radiusMiles)` regenerates all buffers on demand; new `removeStation(index)` for per-feature deletion
- `index.html` — Buffer input added to Features panel; sidebar description updated to reference user-defined radius; "Result in ½-mile union" → "Result in buffer union"
- `js/app.js` — wired `#bufferRadius` input listener; improved no-union messages; added `App.onFeatureDelete` hook
- `css/style.css` — styles for `.fp-buffer-header`, `.fp-radius-input`, `.fp-radius-unit`

### Per-feature delete buttons
Each station, line, and polygon row in the Features panel now shows a trash can icon (inline SVG) on its right side.

**Behavior:**
- Hidden by default; fades in on row hover
- Turns red on direct hover
- Clicking removes that single feature from the map and re-renders

**Files changed:**
- `js/core/stations.js` — added `removeStation(index)`
- `js/core/lines.js` — added `removeLine(index)`
- `js/core/polygons.js` — added `removePolygon(index)`
- `js/core/features.js` — `buildItem()` now creates an SVG trash button; `populateList()` passes the correct remove function per feature type; fires `App.onFeatureDelete` hook after removal
- `js/app.js` — `App.onFeatureDelete` wired to `notifyProject()`
- `css/style.css` — `.fp-delete` hidden by default, fades in on row hover, red on button hover

---

## 2026-02-14 — New panel-based sidebar (Phases 1–6)

Replaced the legacy hardcoded sidebar with a new panel manager system. Built alongside the old sidebar (Phases 1–5), then cut over in Phase 6.

### Architecture
- `js/core/sidebar.js` — new module exposing `App.sidebar` with `addPanel()`, `removePanel()`, `toggle()`, `render()`
- Panels are registered programmatically in `app.js` on map load, with HTML defined as JS strings (not hardcoded in `index.html`)
- Each panel has a collapsible header; click to expand/collapse
- `css/sidebar-v2.css` — panel system styles scoped under `#sidebar`

### Panels (in order)
1. **Station-area Data** (order 10) — geography level, ACS/LODES variable picker, year, Update Summary button, results card
2. **Project** (order 20) — empty `#project-panel` container, filled by the active project's HTML fragment
3. **LODES** (order 30, starts collapsed) — state detection, download button, file picker, status

### Cutover (Phase 6)
- Removed ~90 lines of legacy sidebar HTML from `index.html`
- Removed toggle button and dual-sidebar wiring
- Renamed `#sidebar-v2` → `#sidebar`
- Removed element resolver (`el()`), `show()`/`hide()`/`isActive()` from sidebar.js
- Simplified `setAggUI()` and `setLodesLoadedUI()` back to direct `getElementById`
- Rewrote `app.js` without v2-prefixed IDs, resolver, or dual event wiring
- Removed legacy sidebar CSS rules from `style.css`
- Updated `CLAUDE.md` with new sidebar architecture documentation

**Net result:** 117 lines added, 353 removed across 8 files.

---

## 2026-02-14 — Sidebar narrowing, sub-panel extraction, reorder

### Sidebar narrowed to 310px
- `css/sidebar-v2.css` — width reduced from 520px to 310px; removed `min-width: 180px` from `.sb2-kv b` (too wide at new size)
- `css/style.css` — `.bpGrid` and `.twoCol` changed from 2-column to 1-column grids to stack at the narrower width

### CRE, ESS, LBAR extracted into separate collapsible panels
Previously all three upload forms lived inside the single FTA Small Starts project panel. Each now has its own collapsible panel (collapsed by default).

**New project API:** `App.registerProject()` now accepts an optional `panels[]` array. Each entry declares a sub-panel with `id`, `title`, `htmlFile` (path to an HTML fragment, fetched alongside `panelHTML`), `collapsed`, and `order`. `app.js` registers placeholder containers before `render()`, then fetches and injects HTML in `loadProjectPanel()`. `CLAUDE.md` updated to document the new API.

**Files created:** `projects/fta-cre.html`, `projects/fta-ess.html`, `projects/fta-lbar.html`

**Files changed:** `projects/fta-small-starts.html` (trimmed to breakpoints card only), `js/projects/fta-small-starts.js` (added `panels[]`), `js/app.js` (sub-panel registration + HTML fetch), `CLAUDE.md`

### Panel order changed
Station-area Data (10) → LODES (20) → Community Risk CRE (25) → Essential Services (26) → LBAR Housing (27) → FTA Small Starts (30)

---

## Remaining items (not planned for current scope)

- No Census API key (moderate: lower rate limits without one)
- No subresource integrity (SRI) hashes on CDN script tags
- Phase 4 (migrate right-side Feature Panel into sidebar) — deferred for later consideration
