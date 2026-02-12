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

## Remaining items (not planned for current scope)

- No Census API key (moderate: lower rate limits without one)
- No subresource integrity (SRI) hashes on CDN script tags
- Mixed `.onchange` vs `addEventListener` patterns in FTA project
