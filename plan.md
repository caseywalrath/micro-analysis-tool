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
