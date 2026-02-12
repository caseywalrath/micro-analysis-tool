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

## 2026-02-12 — Documentation

- Created `architecture.md` — file structure, App namespace API, project system reference, sidebar layout, known issues
- Created `changelog.md` (this file)

---

## Remaining work (from plan.md)

### Phase 3: Bug fixes from REVIEW.md
- [ ] TIGERweb pagination: API silently truncates large queries (~1000-2000 feature cap)
- [ ] Breakpoint range gaps: some values fall between defined ranges, return "N/A"
- [ ] Race conditions: overlapping `updateBreakpointRatings()` calls with no guard
- [ ] LODES parser assumes gzip: fails on plain CSV upload
- [ ] No debounce on county FIPS input
- [ ] `turf.intersect` can throw on degenerate geometries

### Phase 4: User-facing documentation
- [ ] README.md — what the tool does, how to run/use it
- [ ] CLAUDE.md — developer/session onboarding (may consolidate with architecture.md)
