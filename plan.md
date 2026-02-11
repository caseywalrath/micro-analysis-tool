# Modularization Plan: micro-analysis-tool

## Goal

Convert a single 1886-line `index.html` into a modular, beginner-friendly project where:

- **Core** = map, station points, buffers, census data fetching, and general geospatial analysis
- **Projects** = domain-specific analysis (like FTA Small Starts) that can be added, swapped, or removed

The result should still be a pure front-end app with no build tools, no backend, and no npm. Open it in a browser and it works.

---

## Guiding Principles

1. **No build step.** Plain HTML, CSS, and JS files loaded via `<script>` tags. Anyone can read and edit the source directly.
2. **Front-end only.** All data stays in the browser. Census APIs are called directly. File uploads are parsed client-side.
3. **Exportable.** The whole tool can be zipped, emailed, or hosted on GitHub Pages. No server configuration needed beyond static file serving.
4. **Readable for future developers and Claude sessions.** Every file has a clear purpose. A `CLAUDE.md` file at the root explains the architecture so any new Claude session can orient quickly.

---

## Proposed File Structure

```
micro-analysis-tool/
│
├── index.html                  # App shell: layout, sidebar skeleton, script tags
├── CLAUDE.md                   # Architecture guide for developers and Claude sessions
├── README.md                   # User-facing overview and usage instructions
├── REVIEW.md                   # (existing) code review notes
├── plan.md                     # (this file)
│
├── css/
│   └── style.css               # All styles (core + common component styles)
│
├── js/
│   ├── core/
│   │   ├── map.js              # Map initialization, basemap, navigation controls
│   │   ├── stations.js         # Station points, buffers, union, coordinate panel
│   │   ├── census.js           # TIGERweb fetch (paginated), ACS fetch, area aggregation
│   │   ├── lodes.js            # LODES file download/upload/parse, block-level employment
│   │   └── utils.js            # CSV parsing, number formatting, GEOID normalization, helpers
│   │
│   ├── projects/
│   │   └── fta-small-starts.js # FTA CIG breakpoints, CRE, LBAR, essential services
│   │
│   └── app.js                  # Startup: wires core modules together, loads active project
│
└── projects/
    └── fta-small-starts.html   # Sidebar HTML fragment for the FTA project panel
```

### Why this structure

| Decision | Reasoning |
|---|---|
| Flat `js/core/` folder, no nesting | Easy to find things. Five files is manageable. |
| `projects/` folder for HTML fragments | Keeps project-specific markup separate from the app shell. |
| `js/projects/` for project JS | One file per project. Self-contained logic + UI wiring. |
| No `node_modules`, no `package.json` | The user is not a coder. Zero tooling friction. |
| Single `css/style.css` | The CSS is ~120 lines. Splitting further adds complexity with no benefit. |

---

## How "Projects" Work

A project is **two files**: a JS file and an HTML fragment.

### The project JS file

Each project file defines a single object and registers it with the core app:

```js
// js/projects/fta-small-starts.js
App.registerProject({
  id: "fta-small-starts",
  name: "FTA Small Starts (Land Use)",

  // Path to the sidebar HTML fragment to inject
  panelHTML: "projects/fta-small-starts.html",

  // Called once after the panel HTML is injected into the DOM
  init(core) {
    // Set up file upload listeners, build CRE/LBAR/ESS UI, etc.
    // `core` provides access to shared state and functions
  },

  // Called whenever stations change or "Update summary" is clicked
  async update(core) {
    // Recompute breakpoint ratings, update DOM
  }
});
```

### What `core` provides

The `core` object passed to project functions exposes:

- `core.stations` — current station points array
- `core.buffers` — current buffer features array
- `core.getUnion()` — dissolved union polygon (or null)
- `core.fetchTigerwebGeos(geoLevel, union)` — paginated TIGERweb query
- `core.fetchACSValues(geoLevel, year, varCode, geoids)` — ACS data fetch
- `core.aggregateWithinUnion(union, geos, valueMap, aggMode)` — area-weighted aggregation
- `core.computeAcsValueOnly(varCode, year, geoLevel)` — convenience wrapper
- `core.fetchBlocksInternalPointsInUnion(union)` — block internal points
- `core.lodesData` — the uploaded LODES Map (or null)
- `core.map` — the MapLibre map instance (for adding project-specific layers)
- `core.utils` — shared helpers (parseCSV, toNumberSafe, formatValue, etc.)

### Loading / unloading

In the initial version, the active project is set by which `<script>` tag is included in `index.html`:

```html
<!-- Core (always loaded) -->
<script src="js/core/utils.js"></script>
<script src="js/core/map.js"></script>
<script src="js/core/stations.js"></script>
<script src="js/core/census.js"></script>
<script src="js/core/lodes.js"></script>
<script src="js/app.js"></script>

<!-- Active project (swap or remove this line) -->
<script src="js/projects/fta-small-starts.js"></script>
```

To use a different project, replace the last `<script>` tag. To run with no project (core only), remove it. A future enhancement could add a dropdown to switch projects at runtime, but that is not needed for v1.

---

## What Goes Where

### Core (always present)

| Current code | New file | What it does |
|---|---|---|
| Map initialization, basemap style, navigation control | `js/core/map.js` | Creates the MapLibre map instance |
| `points`, `buffers`, `addStationPoint`, `bufferUnionPolygon`, `renderStationLayers`, `updateCoordsPanel`, undo/clear handlers | `js/core/stations.js` | Station point + buffer management, map layer rendering |
| `fetchTigerwebPaginated`, `fetchTigerwebGeos`, `fetchACSValues`, `fetchACSCountyValues`, `aggregateWithinUnion`, `computeAcsValueOnly`, `parseGEOID`, `renderCensusOverlay` | `js/core/census.js` | All Census/TIGERweb data fetching and aggregation |
| LODES state detection, file parsing, `fetchBlocksInternalPointsInUnion`, `computeEmploymentServedOnly`, download helper | `js/core/lodes.js` | LODES workflow |
| `parseCSV`, `fillSelect`, `enableSelect`, `toNumberSafe`, `normalizeTractGEOID`, `formatValue`, `guessHeader`, `VAR_META`, `getMeta` | `js/core/utils.js` | Shared utilities |
| Sidebar: station controls, coordinate list, variable/year selectors, "Update summary" button, results card, LODES section | `index.html` | App shell (always-visible UI) |

### FTA Small Starts project

| Current code | New file | What it does |
|---|---|---|
| `BP` breakpoint tables, `classify`, `bumpOneLevel`, `setPill`, `RATING_ORDER` | `js/projects/fta-small-starts.js` | FTA classification logic |
| `CRE_MAP`, CRE upload handler, `buildCreMapFromRows`, `computeCommunityRiskFromCre` | `js/projects/fta-small-starts.js` | CRE upload + computation |
| `ESS_POINTS`, essential services upload handler, `computeEssentialServicesAvg` | `js/projects/fta-small-starts.js` | Essential services upload + computation |
| `LBAR_SITES`, LBAR upload handler, `computeLbarRatio`, LBAR map layer toggle | `js/projects/fta-small-starts.js` | LBAR upload + ratio computation |
| `updateBreakpointRatings` | `js/projects/fta-small-starts.js` | Orchestrates all FTA rating updates |
| Breakpoint grid HTML, CRE/ESS/LBAR upload forms | `projects/fta-small-starts.html` | FTA-specific sidebar sections |

---

## Shared State Model

All shared state lives on a global `App` namespace object rather than as loose global variables. This makes it clear what is core state vs. project state:

```js
// Global namespace (set up in app.js)
window.App = {
  map: null,              // MapLibre instance
  stations: [],           // station point features
  buffers: [],            // buffer polygon features
  lodesData: null,        // Map(w_geocode -> C000) or null
  lodesFileName: "",
  activeProject: null,    // the registered project object

  // Methods exposed for projects
  getUnion() { ... },
  registerProject(config) { ... },
  // ... etc
};
```

Project-specific state (like `CRE_MAP`, `ESS_POINTS`, `LBAR_SITES`) stays **inside the project file** as local variables, not on the global namespace. This keeps projects self-contained.

---

## UI Layout

The sidebar structure in `index.html` becomes:

```
┌─────────────────────────────┐
│  Stations (core)            │  Always visible. Station count,
│  [Delete last] [Clear]      │  undo/clear, coordinate list.
│  Lat/Lon list               │
├─────────────────────────────┤
│  Station-area Data (core)   │  Always visible. Variable picker,
│  Geography / Variable / Year│  year, geography level, "Update
│  [Update summary]           │  summary" button, results card.
│  Result card                │
├─────────────────────────────┤
│  #project-panel             │  Empty <div> that gets filled
│  (injected by project)      │  by the active project's HTML.
│                             │  FTA: breakpoint grid, CRE/ESS/
│                             │  LBAR upload forms.
├─────────────────────────────┤
│  LODES (core)               │  Always visible. Download button,
│  Download / Upload          │  file picker, status.
└─────────────────────────────┘
```

The key change: a single `<div id="project-panel"></div>` placeholder. When a project registers, `app.js` fetches its HTML fragment and injects it there.

---

## Implementation Phases

### Phase 1: Extract files (no behavior change)

Move code out of `index.html` into the file structure above. The app should work identically after this step. Each file uses the `App` namespace to share state.

Verification: open in browser, click stations, run summary, upload files — everything works as before.

#### Phase 1 Segmentation Strategy

Because `index.html` is 1,865 lines (~72KB), Phase 1 must be broken into smaller segments to avoid burning all tokens or causing Claude to hang. The strategy below keeps each step focused and manageable.

**Core approach: build forward, replace at the end.** Create all new module files by reading targeted line ranges of `index.html`. Do NOT incrementally edit `index.html` — write the new shell `index.html` as the final step. This avoids cascading line-number shifts and repeated edits to the same large file.

##### Token Management Rules

- **Never read the entire `index.html` in one Read call.** Always specify `offset` and `limit` to target only the lines needed for the current segment.
- **Each segment reads ≤200 lines** of `index.html` at a time.
- **Commit after every 2–3 segments** to create safe checkpoints.
- **Use Task agents for extraction** where possible — each agent reads specific lines, writes one output file, and returns, keeping the main conversation context clean.
- **Write new `index.html` last** — don't incrementally edit it.

##### Segment 1: Scaffolding (no reads needed)

- Create directory structure: `css/`, `js/core/`, `js/projects/`, `projects/`
- No reads of `index.html` required
- **Commit checkpoint** after this segment

##### Segment 2: CSS → `css/style.css` (~106 lines)

- **Read:** lines 21–126 of `index.html`
- **Write:** `css/style.css` with the CSS content (strip `<style>` tags, keep content as-is)
- No adaptation needed — pure CSS extraction

##### Segment 3: `js/core/utils.js` (~100 lines across 3 ranges)

- **Read:** lines 424–472 (setStatus, parseCSV, fillSelect, enableSelect, toNumberSafe, normalizeTractGEOID)
- **Read:** lines 617–670 (VAR_META, getMeta, formatValue)
- **Read:** lines 948–955 (guessHeader — used by both core and FTA)
- **Write:** `js/core/utils.js` — wrap functions in assignments to `App.utils` namespace
- These are pure functions with no internal dependencies beyond PapaParse (external CDN)

##### Segment 4: `js/core/map.js` (~30 lines)

- **Read:** lines 393–422 (rasterStyle definition, MapLibre map init, NavigationControl)
- **Write:** `js/core/map.js` — assign map instance to `App.map`
- **Commit checkpoint** after segments 2–4

##### Segment 5: `js/core/stations.js` (~87 lines)

- **Read:** lines 474–560 (points, buffers, addStationPoint, updateCoordsPanel, renderStationLayers, bufferUnionPolygon, bboxStringFromFeature)
- **Write:** `js/core/stations.js` — expose via `App.stations`, `App.buffers`, `App.getUnion()`, etc.
- Dependencies: `App.map` (from map.js), turf (external)

##### Segment 6: `js/core/census.js` (~198 lines)

- **Read:** lines 734–931 (renderCensusOverlay, fetchTigerwebGeos, parseGEOID, fetchACSValues, fetchACSCountyValues, aggregateWithinUnion, computeAcsValueOnly)
- **Write:** `js/core/census.js` — expose via `App.fetchTigerwebGeos()`, `App.aggregateWithinUnion()`, etc.
- Dependencies: `App.map`, turf, `App.utils` (for VAR_META, toNumberSafe)
- **Commit checkpoint** after segments 5–6

##### Segment 7: `js/core/lodes.js` (~147 lines)

- **Read:** lines 1153–1299 (STATE_FIPS_TO_ABBR, fetchBlocksInternalPointsInUnion, parseLodesFromUploadedFile, computeEmploymentServedOnly, download helper)
- **Write:** `js/core/lodes.js` — expose `App.lodesData`, LODES parse/compute functions
- Dependencies: `App.census.fetchTigerwebGeos()`, pako (external), turf

##### Segment 8: `js/projects/fta-small-starts.js` (3 sub-reads, ~490 lines total)

This is the largest extraction. Split reading into 3 sub-reads but write to a single file:

- **Read 8a:** lines 561–732 (~172 lines) — LBAR plotting functions (lbarSitesToGeoJSON, ensureLbarLayer, removeLbarLayer, refreshLbarLayerVisibility), BP breakpoint tables, classify, bumpOneLevel, setPill, RATING_ORDER
- **Read 8b:** lines 933–1151 (~219 lines) — CRE state + builder + compute, ESS extract/compute, LBAR compute
  - If 219 lines is too large, split into CRE+ESS (933–1044, 112 lines) and LBAR (1047–1151, 105 lines)
- **Read 8c:** lines 1300–1400 (~101 lines) — updateBreakpointRatings

- **Write:** `js/projects/fta-small-starts.js` — structured as an `App.registerProject({...})` call with `init()` and `update()` hooks. All FTA-specific state (CRE_MAP, ESS_POINTS, LBAR_SITES) stays local to this file.
- **Commit checkpoint** after segments 7–8

##### Segment 9: FTA sidebar HTML → `projects/fta-small-starts.html` (~146 lines)

- **Read:** lines 215–360 of `index.html` (breakpoint grid card + CRE/ESS/LBAR upload forms)
- **Write:** `projects/fta-small-starts.html` — just the HTML fragment (no `<html>`/`<body>` wrapper)
- This is pure HTML, no adaptation needed

##### Segment 10: `js/app.js` + new `index.html` (~270 lines read across 2 ranges)

- **Read:** lines 1402–1508 (~107 lines) — runLodesEmploymentSummary, runSummary
- **Read:** lines 1510–1862 (~352 lines) — map.on("load"), all event bindings
  - **Important:** This is the largest single read. If needed, split into:
    - Core event bindings (1510–1620, ~110 lines) → `js/app.js`
    - FTA event bindings (1620–1862, ~242 lines) → append to `fta-small-starts.js` init()
- **Write:** `js/app.js` — App namespace setup, registerProject(), summary runners, core event wiring
- **Write:** new `index.html` shell (~120 lines) containing:
  - `<head>` with CDN script/link tags + `<link>` to `css/style.css`
  - Core sidebar HTML (lines 131–213 for stations + data; lines 362–390 for LODES)
  - `<div id="project-panel"></div>` placeholder between results card and LODES section
  - `<div id="map"></div>`
  - `<script>` tags for all JS modules in dependency-safe load order
- **Commit checkpoint** after segments 9–10

##### Segment 11: Verification

- Verify file structure matches the plan (all 11 files exist)
- Open the app in a browser — map should render
- Click to add stations — buffers should appear
- Run "Update summary" — ACS values should compute
- Verify no JS console errors
- If FTA script is included, breakpoint panel should appear and function
- **Final commit** for Phase 1

##### Dependency-Safe Script Load Order

```html
<!-- External libs (CDN) -->
<link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet" />
<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<script src="https://unpkg.com/@turf/turf@6.5.0/turf.min.js"></script>
<script src="https://unpkg.com/pako@2.1.0/dist/pako.min.js"></script>
<script src="https://unpkg.com/papaparse@5.4.1/papaparse.min.js"></script>

<!-- Core modules (order matters) -->
<script src="js/core/utils.js"></script>    <!-- no deps -->
<script src="js/core/map.js"></script>      <!-- creates App.map -->
<script src="js/core/stations.js"></script> <!-- needs App.map -->
<script src="js/core/census.js"></script>   <!-- needs App.map, App.utils -->
<script src="js/core/lodes.js"></script>    <!-- needs census functions -->
<script src="js/app.js"></script>           <!-- wires everything, exposes core API -->

<!-- Project (optional — swap or remove) -->
<script src="js/projects/fta-small-starts.js"></script>
```

##### HTML Body Split Reference

**Core HTML (stays in `index.html`):**
- Lines 131–213: Stations controls + Station-area Data (selectors, run button, results card)
- Lines 362–390: LODES section (download button, file upload, status)

**FTA HTML (extracted to `projects/fta-small-starts.html`):**
- Lines 215–263: Breakpoint ratings grid (6 bpItems)
- Lines 265–360: Upload forms (CRE, Essential Services, LBAR)

**Placeholder in new `index.html`:**
- Between the results card (line ~213) and LODES section (line ~362): `<div id="project-panel"></div>`

---

### Phase 2: Define the project interface

Add `App.registerProject()` in `app.js`. Move the FTA-specific code into `js/projects/fta-small-starts.js` and the FTA sidebar HTML into `projects/fta-small-starts.html`. Wire up the `init` and `update` hooks.

Verification: remove the FTA script tag — the core app still works (map, stations, ACS summaries, LODES). Add it back — FTA panel appears and functions.

### Phase 3: Fix remaining bugs from REVIEW.md

With the code now split into manageable files, work through the remaining bugs:

- Bug #2: Breakpoint range gaps (in `fta-small-starts.js`)
- Bug #3: Race conditions / concurrency guard (in `app.js`)
- Bug #4: LODES gzip detection (in `lodes.js`)
- Bug #6: Debounce county FIPS input (in `fta-small-starts.js`)
- Bug #7: turf.intersect error handling (in `census.js`)

### Phase 4: Documentation

- **CLAUDE.md**: Architecture overview, file-by-file descriptions, how to add a new project, naming conventions. This is the primary onboarding document for new Claude sessions.
- **README.md**: What the tool does, how to run it, how to use it, how to add a project.
- Inline comments: Each JS file gets a header comment block explaining its purpose and public API. Functions that implement non-obvious logic (area apportionment, LBAR boost) get brief comments.

---

## How to Add a New Project (Future)

1. Create `js/projects/my-project.js` with an `App.registerProject({ ... })` call
2. Create `projects/my-project.html` with the sidebar panel markup
3. Add a `<script src="js/projects/my-project.js"></script>` tag in `index.html`
4. The project's `init()` sets up upload handlers and UI
5. The project's `update()` runs whenever the core data changes

No core code needs to change.

---

## What This Plan Does NOT Include

- **Build tools** (webpack, vite, etc.) — adds complexity with no benefit at this scale
- **A backend or database** — data stays in the browser
- **Multi-project runtime switching** — v1 uses one project at a time via script tags. A dropdown could be added later.
- **TypeScript** — adds tooling requirements
- **Testing framework** — could be added later but is not part of the initial modularization
- **Lines and polygons** — mentioned as a future core feature, but not part of this restructuring. The `stations.js` file is where this would be added.

---

## File Size Estimates

| File | Approx. lines | Purpose |
|---|---|---|
| `index.html` | ~120 | HTML shell + script tags |
| `css/style.css` | ~120 | All styles |
| `js/core/utils.js` | ~60 | Shared helpers |
| `js/core/map.js` | ~30 | Map setup |
| `js/core/stations.js` | ~120 | Points, buffers, rendering |
| `js/core/census.js` | ~200 | TIGERweb + ACS + aggregation |
| `js/core/lodes.js` | ~160 | LODES workflow |
| `js/app.js` | ~80 | Startup, project registration, event wiring |
| `js/projects/fta-small-starts.js` | ~550 | All FTA logic + upload handlers |
| `projects/fta-small-starts.html` | ~100 | FTA sidebar HTML |
| `CLAUDE.md` | ~80 | Architecture guide |

Total: ~1620 lines across 11 files (vs. 1886 in one file today). The modest line reduction comes from removing some duplication; the real gain is organization.
