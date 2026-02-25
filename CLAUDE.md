# CLAUDE.md

Project onboarding for Claude Code sessions. Read this first.

## Developer Context

**User Experience Level**: Beginner/non-coder
- Limited experience with Git, GitHub, and project development
- Does not read or understand code
- Interfaces with Claude through web/chat, not terminal-based development
- Requires clear, step-by-step instructions with explicit file paths

---

## Communication Guidelines

- Use plain language, avoid jargon where possible
- Always specify full file paths (e.g., `src/App.jsx` not "the main file")
- Explain *where* code changes are happening before making them
- Verify branch state before implementing features
- Show git commands explicitly: `git status`, `git pull`, `git checkout branch-name`
- Explain deployment implications (what happens when code is pushed)
- Confirm which branch should be used as base before starting work
- Use specific line numbers when referencing code locations
**At session start**: Always notify the user what branch you are working on and why a new branch was created. Example: "This session is on branch `claude/review-changelog". It was created automatically for this session and includes all prior work."

## Common Issues to Prevent

- Wrong branch base → old UI deploying
- Features reverting due to unclear git state
- Changes made to wrong files
- User confusion about what version is "live"
- User not knowing a new branch was created or how to work from it
## Overview

Browser-based geospatial analysis tool. Pure front-end (no build step, no backend, no npm). Open `index.html` in a browser and it works. All data stays client-side; Census APIs are called directly.

## File Structure

```
index.html                  App shell: toolbar, sidebar, map, feature panel, results modal, module popup container, script tags
css/
  style.css                 Core layout, toolbar, feature panel, results modal, module popup, floating widgets, basemap switcher, TPI styles, RF styles (.rf- prefix)
  sidebar-v2.css            Sidebar panel system styles (scoped under #sidebar), variable checkbox list
js/
  app.js                    Startup, module registry, sidebar panel HTML, multi-variable summary runner, results modal, event wiring
  core/
    utils.js                CSV parsing, number formatting, GEOID normalization, VAR_META (with label/category), getSelectedVars
    sidebar.js              Sidebar panel manager: addPanel, removePanel, toggle, render
    map.js                  MapLibre GL map instance, basemap registry + switcher control, cursor management
    stations.js             Station points, user-defined buffers (default 0.5 mi), union polygon, station drag support
    lines.js                Line drawing (polylines with snap-to-close), line buffers (default 0.5 mi), rubber-band preview, vertex editing
    routes.js               Route drawing (OSRM street-snapped), route buffers (default 0.5 mi), throttled snapped preview, waypoint-only vertex editing
    polygons.js             Polygon drawing (vertex-by-vertex with snap-to-close), rubber-band preview, vertex editing
    editing.js              Feature editing: station click-drag, line/polygon/route vertex editing with orange handles
    features.js             Right-side feature panel: lists features, editable names, delete buttons
    census.js               TIGERweb geometry queries, ACS data fetch, area-weighted aggregation
    lodes.js                LODES .csv.gz download/upload/parse, block-level employment
    cache.js                Session cache: save/restore/reset via localStorage; JSON import/export
    popup.js                Analysis popup manager: open/close module popups, floating map widgets (legend)
  projects/
    fta-small-starts.js     FTA Small Starts: breakpoint classification, CRE/ESS/LBAR (registered as disabled module)
    tpi-scoring.js          TPI scoring engine: 9-factor definitions, batch ACS fetch, LODES aggregation, quintile normalization, composite scoring
    transit-propensity.js   TPI module: popup-based UI with weight sliders, choropleth rendering, hover tooltips, floating legend, GeoJSON/CSV export, stale detection
    ridership-scoring.js    Ridership scoring engine: corridor CDI computation, per-route CDI extraction, system-wide demand orchestration, CSV route matching, segment analysis, service type presets, elasticity formulas, scenario builder, ratio/OLS calibration (window.RidershipModel namespace)
    ridership-forecasting.js  Ridership Forecasting module: 4-tab popup (Calibrate | Demand | Elasticity | Scenarios), 3-step calibration workflow, corridor dropdown, choropleth + segment map, scenario comparison table, GeoJSON/CSV/JSON export
projects/
  fta-small-starts.html     FTA sidebar HTML fragment (legacy, kept for future popup migration)
  transit-propensity-popup.html  TPI popup body: 3-column layout (Weights | Results | Actions)
  transit-propensity.html   TPI sidebar panel (legacy, replaced by popup version)
  tpi-weights.html          TPI weight sliders (legacy, merged into popup)
  tpi-legend.html           TPI legend: 5-class Blues color swatches (reused by floating widget)
  ridership-forecasting-popup.html  RF popup body: 4-tab layout (Calibrate first), 3-step calibration workflow UI (system analysis → CSV upload → match/calibrate), corridor dropdown in Demand tab, CDI info button (ⓘ toggle), segment breakdown, elasticity sliders, scenario sub-tabs, comparison table
  ridership-legend.html     RF demand legend: 5-class Blues swatches for CDI score (High → Low)
docs/
  ridership-forecasting-plan.md  Strategic evaluation and implementation plan for the ridership forecasting tool
Ridership_Forecast_Readme.md    User-facing documentation for the Ridership Forecasting module (plain-language, transit professional audience)
```

## Conventions

- **No build tools.** Plain `<script>` tags in dependency order. Anyone can read/edit the source directly.
- **Global namespace.** All shared state and functions live on `window.App`. Each module IIFE reads `var App = window.App` and assigns its exports (e.g., `App.fetchTigerwebGeos = fetchTigerwebGeos`).
- **Module-local state stays private.** Variables like `CRE_MAP`, `ESS_POINTS`, `LBAR_SITES` (FTA) and `_lastResult`, `_stale`, `_running` (TPI, RF) are declared inside the module IIFE closure, not on `App`. Scoring engines use separate window namespaces: `window.TPI` (TPI scoring), `window.RidershipModel` (ridership scoring).
- **Panel-based sidebar.** Sidebar content is registered via `App.sidebar.addPanel()` and rendered on map load. Panel HTML is defined as strings in `app.js`, not hardcoded in `index.html`. Call `render()` once after all panels are registered (avoids destroying event listeners).
- **Analysis popups.** Analysis modules open in popup windows (not the sidebar). The popup system (`App.popup`) handles HTML loading, init/open/close lifecycle, and Escape key. Floating widgets (like the TPI and RF legends) persist on the map independently of the popup.
- **Tabbed popup layout.** Multi-step analysis modules (e.g., Ridership Forecasting) use a tab bar (`<div class="rf-tabs">` with `[data-tab]` buttons) and tab content panels (`<div class="rf-tab-content" data-tab="...">`) toggled via a `switchTab(id)` function in the module JS. State is saved to closure variables on tab switch; the form is not reset.
- **Inline info buttons.** Contextual help uses a small `<button class="rf-info-btn">ⓘ</button>` element adjacent to the label, wired in `init()` to toggle a sibling explanation `<div>` via `style.display`. No tooltip libraries needed.
- **CSS namespacing.** TPI styles use `.tpi-` prefix. Ridership Forecasting styles use `.rf-` prefix. Both live in `css/style.css`.
- **External libraries via CDN:** MapLibre GL JS, Turf.js, pako (gzip), PapaParse (CSV).

## Script Load Order

Order matters because modules depend on earlier ones:

```
utils.js    (no deps)
sidebar.js  (needs App namespace from utils.js)
map.js      (creates App.map, basemap switcher, cursor handlers)
stations.js (needs App.map, turf)
lines.js    (needs App.map, turf)
routes.js   (needs App.map, turf, fetch/AbortController)
polygons.js (needs App.map)
editing.js  (needs App.map, App.stations, App.lines, App.routes, App.polygons, move/update functions)
features.js (needs App.stations, App.lines, App.routes, App.polygons, App.removeStation, etc.)
census.js   (needs App.map, App.bboxStringFromFeature, App.getMeta, turf)
lodes.js    (needs App.map, App.bboxStringFromFeature, App.bufferUnionPolygon, pako, turf)
cache.js    (needs App.stations, App.lines, App.routes, App.polygons, render/rebuild functions)
popup.js    (needs App namespace; defines App.popup)
app.js              (wires everything; registers sidebar panels; defines App.registerModule; calls cache.restore)
<modules>           (call App.registerModule)
  fta-small-starts.js   (needs App namespace; registers as disabled module)
  tpi-scoring.js        (needs App namespace, turf; defines window.TPI)
  transit-propensity.js (needs TPI, App.registerModule, App.popup, App.map, App.renderCensusOverlay)
  ridership-scoring.js  (needs window.TPI, App namespace, turf; defines window.RidershipModel)
  ridership-forecasting.js (needs RidershipModel, TPI, App.registerModule, App.popup, App.map, App.renderCensusOverlay)
```

**Active modules:** TPI is enabled (popup-based). Ridership Forecasting is enabled (popup-based, 4-tab). FTA Small Starts is registered but disabled (button shown grayed out).

## App Namespace (Public API)

### utils.js
`setStatus(s)`, `parseCSV(text)`, `fillSelect(el, opts, placeholder)`, `enableSelect(el, bool)`, `toNumberSafe(v)`, `normalizeTractGEOID(raw)`, `guessHeader(headers, candidates)`, `VAR_META`, `getMeta(code)`, `setAggUI(meta)`, `formatValue(val, meta)`, `getSelectedVars()`

### sidebar.js
`sidebar.addPanel(config)`, `sidebar.removePanel(id)`, `sidebar.toggle(id)`, `sidebar.render()`

Panel config: `{ id, title, html, collapsed (default false), order (default 100) }`

### map.js
`map` (MapLibre instance), `switchBasemap(basemapId)`

Basemap IDs: `"carto-light"` (default), `"carto-dark"`, `"osm"`, `"satellite"`

### stations.js
`stations` (Point array), `buffers` (Polygon array), `addStationPoint(lon, lat)`, `rebuildBuffers(radiusMiles)`, `moveStation(index, lng, lat)`, `removeStation(index)`, `clearStations()`, `undoLastStation()`, `renderStationLayers()`, `bufferUnionPolygon()`, `getUnion()` (alias), `bboxStringFromFeature(feat)`

### lines.js
`lines` (LineString array), `lineBuffers` (Polygon array), `handleLineClick(lngLat)`, `rebuildLineBuffers(radiusMiles)`, `lineBufferUnionPolygon()`, `removeLine(index)`, `clearLines()`, `undoLastLine()`, `cancelLineDrawing()`, `renderLineLayers()`, `setLinePreview(lngLat)`, `updateLineVertex(lineIndex, vertexIndex, lng, lat)`

### routes.js
`routes` (LineString array with `waypoints` property), `routeBuffers` (Polygon array), `handleRouteClick(lngLat)`, `setRoutePreview(lngLat)`, `rebuildRouteBuffers(radiusMiles)`, `routeBufferUnionPolygon()`, `removeRoute(index)`, `clearRoutes()`, `undoLastRoute()`, `cancelRouteDrawing()`, `renderRouteLayers()`, `updateRouteWaypoint(routeIndex, waypointIndex, lng, lat)`

Route features store `properties.waypoints` (user click points) separately from the full street-snapped `geometry.coordinates`. Vertex editing shows handles on waypoints only. OSRM demo server used for routing (`https://router.project-osrm.org/route/v1/driving/`). Preview is throttled: straight line immediately, street-snapped after ~1s of mouse idle (AbortController used to cancel stale fetches).

### polygons.js
`polygons` (Polygon array), `handlePolygonClick(lngLat)`, `removePolygon(index)`, `clearPolygons()`, `undoLastPolygon()`, `cancelPolygonDrawing()`, `renderPolygonLayers()`, `setPolygonPreview(lngLat)`, `updatePolygonVertex(polyIndex, vertexIndex, lng, lat)`

### editing.js
`_editing` (edit state or null), `exitEditMode()`, `_initEditing()` (called from app.js on map load)

### features.js
`refreshFeaturePanel()`

### census.js
`renderCensusOverlay(geos)`, `fetchAllTigerwebFeatures(layerUrl, params)`, `fetchTigerwebGeos(geoLevel, unionFeat)`, `parseGEOID(geoLevel, geoid)`, `fetchACSValues(geoLevel, year, varCode, geoids)`, `fetchACSCountyValues(year, varCode, counties)`, `aggregateWithinUnion(unionFeat, geos, valueMap, aggMode)`, `computeAcsValueOnly(varCode, year, geoLevel)`

### lodes.js
`STATE_FIPS_TO_ABBR`, `getStateFromMapCenter()`, `startDownload(url, filename)`, `lodesData` (Map or null), `lodesFileName`, `setLodesLoadedUI(loaded, name, nRows)`, `parseLodesFromUploadedFile(file)`, `fetchBlocksInternalPointsInUnion(unionFeat)`, `computeEmploymentServedOnly()`

### cache.js
`cache.save()`, `cache.restore()`, `cache.reset()`, `cache.exportToFile()`, `cache.importFromFile(file)`, `cache.STORAGE_KEY`

Saves session state (stations, lines, routes, polygons, buffer radii, form selections, LODES filename) to `localStorage` under key `"mat-session"`. Routes store full geometry + waypoints; no re-routing needed on restore. Restore runs automatically at end of map load. Save is debounced (500ms) and called after every state mutation. Reset clears localStorage and all app state. LODES data is NOT cached (too large); only the filename is stored as a re-upload hint.

`exportToFile()` serializes current state to a timestamped `.json` file and triggers a browser download. `importFromFile(file)` reads a JSON file (from a hidden `<input type="file">`), validates it, and applies the state — replacing all current features. Both use the same schema as localStorage (`version: 1`).

### popup.js
`popup.open(moduleId, modules, buildCore)`, `popup.close()`, `popup.isOpen()`, `popup.currentModuleId()`, `popup.showFloatingWidget(id, htmlFile, options)`, `popup.hideFloatingWidget(id)`, `popup.removeFloatingWidget(id)`, `popup.wire(modules, buildCore)`

Floating widget options: `{ position: "bottom-left"|"bottom-right"|"top-left"|"top-right", width: px, title: string }`

### app.js
`drawMode`, `registerModule(config)`, `registerProject(config)` (alias for registerModule), `notifyProject()`, `onFeatureDelete()` (hook, see below)

### tpi-scoring.js (window.TPI namespace, not on App)
`TPI.FACTORS` (9-factor array with id, label, weight, acsCodes, compute functions), `TPI.batchFetchACS(geoLevel, year, geoids)`, `TPI.aggregateLodesToGeo(lodesData, geoLevel, geoids)`, `TPI.computeQuintiles(values)`, `TPI.computeComposite(factorScores, weights)`, `TPI.computeTPI(options)` (full pipeline: fetch → normalize → score), `TPI.rescoreFromRaw(rawValues, weights, geoids)` (instant re-score from cached data)

### transit-propensity.js (analysis module, no public API)
Registers module `"transit-propensity"` as a popup-based analysis. Opens in a 3-column popup (Weights | Results | Actions) with its own geography/year selectors. Internal functions: `runTPI()`, `runInstantRescore()`, `renderChoropleth(result)`, `clearChoropleth()`, `displayResults(result)`, `exportGeoJSON()`, `exportCSV()`, `markStale()`. All state is private to the IIFE closure. DOM writes are guarded with `isPopupVisible()` so `update()` can safely fire when the popup is closed.

### ridership-scoring.js (window.RidershipModel namespace, not on App)
Scoring engine for the Ridership Forecasting module. Depends on `window.TPI` for demand computation.

`RidershipModel.SERVICE_TYPES` — array of 4 service type presets (local_bus, enhanced_bus, limited_stop, brt), each with `id`, `label`, default operating parameters (`defaultSpeed`, `defaultHeadway`, `defaultSpan`, `defaultStopSpacingMi`), and premium ranges (`freqPremium`, `speedPremium`, `modePremium` each as `{ low, mid, high }` fractions).

`RidershipModel.getServiceType(id)` — returns a service type preset by id.

`RidershipModel.computeCorridorDemand(options)` — wraps `TPI.computeTPI()`, then computes the Corridor Demand Index (CDI) as a population-weighted average of TPI composite scores. Options: `{ geoLevel, year, weights, lodesData, apportionByArea, segmentLengthMiles, onProgress }`. Returns `{ tpiResult, corridorCDI: { value, scored, total }, segments: [...], classification }`.

Segment objects: `{ cdi, classification, geoCount, bufferGeometry }`. Segments are produced by chunking all route geometries with `turf.lineChunk()`, buffering each chunk, and re-aggregating TPI geographies by overlap fraction — no additional Census API calls.

`RidershipModel.classifyCDI(score)` — returns `{ label, level, cssClass }` for a numeric CDI (High ≥4, Medium 3–3.9, Low-Medium 2–2.9, Low <2).

`RidershipModel.getRouteLength()` — returns total length in miles of all drawn routes via `turf.length()`.

`RidershipModel.applyElasticity(baseCDI, params)` — applies frequency elasticity and service type premiums to produce `{ low, mid, high }` ridership multipliers. Frequency effect formula: `(newFreq / oldFreq) ^ elasticity` where `freq = 60 / headwayMinutes`. Combined multiplier: `freqEffect × (1 + freqPremium) × (1 + speedPremium) × (1 + modePremium)`. Returns `{ low, mid, high, freqEffect, serviceType }`.

`RidershipModel.buildScenario(params)` — computes operating metrics for one scenario. Key formulas: `vehiclesNeeded = ceil(2 × routeLength / avgSpeed / (headway/60))`, `revHoursPerDay = vehiclesNeeded × span`, `annualRevHours = revHoursPerDay × serviceDays`, `annualCost = annualRevHours × costPerRevHour`. Ridership uses elasticity result scaled by optional calibration factor. Returns full scenario object with low/mid/high ridership, cost/boarding, boardings/rev-hr.

`RidershipModel.compareScenarios(scenarios[])` — builds scenario objects for up to 4 scenarios; returns array.

`RidershipModel.calibrateRatio(rows, demandColKey, ridershipColKey)` — ratio-based calibration: `factor = mean(observed / CDI)`. Returns `{ factor, n, rSquared, method: "ratio" }`.

`RidershipModel.calibrateRegression(rows, demandColKey, ridershipColKey)` — OLS regression: `ridership = intercept + slope × CDI`. Returns `{ factor (=slope), intercept, n, rSquared, method: "regression" }`. Requires n ≥ 3.

`RidershipModel.computePerRouteCDI(tpiResult)` — Takes a system-wide TPI result and extracts a CDI score for each individual drawn route and line. Uses population-weighted intersection (same pattern as segment analysis) against each feature's own buffer polygon. Returns array of `{ name, featureType ("route"|"line"), featureIndex, cdi, classification, geoCount }`. Enables meaningful CDI variation across corridors (urban routes score high, suburban routes score low), which is required for valid calibration.

`RidershipModel.computeSystemDemand(options)` — Orchestrator that runs `TPI.computeTPI()` once across all drawn features with shared quintile normalization, then computes both the system-wide CDI and per-route CDI array. Options: `{ geoLevel, year, weights, lodesData, apportionByArea, onProgress }`. Returns `{ tpiResult, systemCDI, routeCDIs, geoLevel, year }`.

`RidershipModel.matchRoutesToCSV(routeCDIs, csvRows, nameCol)` — Case-insensitive exact name matching between drawn features (from `computePerRouteCDI`) and CSV rows. Returns `{ matched: [{ csvRow, routeCDI, csvRowIndex }], unmatched: [...], duplicateWarnings: [] }`. Used in the Calibrate tab "Match Routes" step.

### ridership-forecasting.js (analysis module, no public API)
Registers module `"ridership-forecasting"` as a popup-based analysis. Opens in a 4-tab popup (960px wide). All state is private to the IIFE closure. DOM writes are guarded with `isPopupVisible()`.

**Tab 1 – Calibrate** (now first): 3-step gated workflow. Step 1: "Analyze System" — geography/year settings + button; calls `RidershipModel.computeSystemDemand()` and shows a per-route CDI score table. Step 2: "Upload CSV" — file picker, auto-column detection via `App.guessHeader()`, "Match Routes" button; calls `RidershipModel.matchRoutesToCSV()` and shows green/red match results. Step 3: "Run Calibration" — uses matched (CDI, ridership) pairs (one per route) for ratio-based or OLS regression calibration. Each step is unlocked by completing the previous one. Calibration factor persists across tabs.

**Tab 2 – Demand**: Corridor dropdown ("Analyze corridor") populated from per-route CDI data lets the user select a specific route/line or the system-wide CDI. If calibration has been run, the displayed CDI reflects that corridor's score relative to the shared quintile normalization. If calibration has not been run, an uncalibrated warning banner is shown but analysis still works. Renders CDI choropleth on map (Blues color ramp), segment overlay, and floating legend widget (`projects/ridership-legend.html`). CDI info button (ⓘ) toggles inline explanation. GeoJSON and CSV export enabled after analysis.

**Tab 3 – Elasticity**: Service type dropdown, baseline/proposed headway inputs, frequency elasticity slider (0.1–1.0, default 0.5). Uses `getActiveCDI()` (see below) so the CDI automatically reflects the selected corridor. Calls `RidershipModel.applyElasticity()` and displays Conservative / Moderate / Optimistic ridership ranges. Recalculates instantly on any input change (no API calls).

**Tab 4 – Scenarios**: 4 sub-tabs (A–D) sharing one input form (state saved/restored on tab switch). Uses `getActiveCDI()` for the active corridor CDI. "Build Scenarios" calls `RidershipModel.buildScenario()` for each and renders a comparison table with mid rows highlighted. CSV and JSON export enabled after build.

**`getActiveCDI()`** (internal helper): Returns the CDI value for the currently selected corridor. Checks `_selectedCorridor` against `_perRouteCDI`; falls back to `_systemResult.systemCDI.value`, then `_lastResult.corridorCDI.value`. Replaces all hardcoded `_lastResult.corridorCDI.value` references in Elasticity and Scenarios tabs, so they automatically update when the corridor selection changes.

**Module-local state**: `_lastResult` (legacy demand result from Demand tab), `_systemResult` (result from `computeSystemDemand()`), `_perRouteCDI` (per-route CDI array), `_matchResult` (CSV match result), `_selectedCorridor` ("all" or "route:N"/"line:N"), `_calibration` (calibration coefficients), `_calibData` (uploaded CSV rows), `_scenarios` (array of 4 scenario param sets), `_activeScenario`, `_stale`, `_running`, `_initialized`, `_apportionByArea`, `_activeTab`.

## Analysis Module System

Analysis modules are optional domain-specific analyses that plug into the core. Each module registers itself at load time and appears as a button in the "Analysis" sidebar panel. Multiple modules can be registered simultaneously. Clicking a module button opens its popup window.

### Registration

A module registers itself at load time by calling:

```js
App.registerModule({
  id: "my-analysis",
  name: "Human-readable Name",
  enabled: true,                                  // false = button shown grayed out
  popupWidth: 720,                                // dialog width in px
  popupHTML: "projects/my-analysis-popup.html",   // popup body HTML fragment path

  init: function (core) {
    // Called once, the first time the popup opens (lazy init).
    // Wire event listeners, build dynamic UI, etc.
    // DOM elements from popupHTML are accessible at this point.
  },

  onOpen: function (core) {
    // Called every time the popup opens. Refresh display from current state.
  },

  onClose: function (core) {
    // Called when the popup closes. Cleanup is optional — state persists in closure.
  },

  update: async function (core) {
    // Called whenever core data changes (features, LODES, etc.).
    // Fires even when popup is closed — guard DOM writes with App.popup.isOpen().
  }
});
```

`App.registerProject` is a backward-compat alias for `App.registerModule`.

### The `core` object

Passed to `init()`, `onOpen()`, `onClose()`, and `update()`. Provides the module with access to shared state and functions without reaching into `App` directly:

| Key | Type | Description |
|-----|------|-------------|
| `stations` | Array | Current station Point features |
| `buffers` | Array | Current buffer Polygon features |
| `routes` | Array | Current route LineString features (with `properties.waypoints`) |
| `routeBuffers` | Array | Current route buffer Polygon features |
| `map` | MapLibre.Map | The map instance |
| `lodesData` | Map or null | Parsed LODES data (w_geocode -> C000) |
| `lodesFileName` | string | Current LODES file name |
| `getUnion()` | Function | Dissolved buffer union polygon (or null) |
| `fetchTigerwebGeos(level, union)` | Function | Query TIGERweb for tracts/block groups |
| `fetchACSValues(level, year, code, geoids)` | Function | Fetch ACS variable values |
| `fetchACSCountyValues(year, code, counties)` | Function | Fetch county-level ACS values |
| `aggregateWithinUnion(union, geos, values, mode)` | Function | Area-weighted aggregation |
| `computeAcsValueOnly(code, year, level)` | Function | Convenience ACS wrapper |
| `computeEmploymentServedOnly()` | Function | Sum LODES jobs in union |
| `fetchBlocksInternalPointsInUnion(union)` | Function | TIGERweb block internal points |
| `utils.*` | Object | Shared helpers: `setStatus`, `parseCSV`, `toNumberSafe`, `normalizeTractGEOID`, `guessHeader`, `fillSelect`, `enableSelect`, `formatValue`, `getMeta`, `setAggUI` |

The existing FTA module still accesses `App.*` directly in its internal functions. New modules should prefer `core.*` for cleaner dependency boundaries.

### How to add a new analysis module

1. Create `js/projects/my-analysis.js` with an `App.registerModule({...})` call
2. Create `projects/my-analysis-popup.html` with the popup body markup
3. Add `<script src="js/projects/my-analysis.js"></script>` to `index.html` (after `app.js`)
4. The module button automatically appears in the Analysis sidebar panel

Multiple modules can be active simultaneously. No core code needs to change.

### How to run with no modules

Remove all module `<script>` tags from `index.html`. The Analysis sidebar panel will not appear. The core app (map, stations, ACS summaries, LODES) works independently.

## Layout

```
+---------------------------------------------------------------+
|  Toolbar                                                      |
|  [Station] [Line] [Route] [Polygon]   [Delete Last] [Clear] [Reset Session] |
+------------------+------------------------+-------------------+
|  Sidebar (left)  |        Map (center)    | Feature Panel (R) |
|  310px           |        flex            | 240px             |
+------------------+------------------------+-------------------+
```

### Sidebar (left, panel-based)

The sidebar is an empty `<div id="sidebar">` populated at runtime by `App.sidebar`. Panels are registered in `app.js` on map load, then `render()` builds the DOM. Each panel has a collapsible header (click to toggle). Panel HTML strings live in `app.js` (station-data, lodes) or are built from registered modules (analysis).

```
+-----------------------------+
|  ▾ Buffer-Area Data         |  Collapsible panel (order 10)
|  Geography level dropdown,  |  Select all / Clear all links,
|  checkbox list of variables |  checkbox groups: Land Use, Employment,
|  (11 ACS/LODES vars),      |  Mobility, Non-additive Medians.
|  Year dropdown,             |  [Update summary] button opens results
|  [Update summary]           |  popup modal with 4-col table.
|  Status card + View Results |  "View Results" re-opens last results.
+-----------------------------+
|  ▸ LODES (File-based)       |  Collapsible panel (order 20, starts collapsed)
|  Download / Upload          |  Download button, file picker, status.
+-----------------------------+
|  ▾ Analysis                 |  Collapsible panel (order 30)
|  [Transit Propensity Index] |  Button: opens TPI popup (3-column layout)
|  [Ridership Forecasting]    |  Button: opens RF popup (4-tab layout)
|  [FTA Small Starts] (gray)  |  Button: disabled (coming soon)
+-----------------------------+
```

Clicking an analysis module button opens a popup window over the map. The TPI popup has a 3-column layout (Weights | Results | Actions). The Ridership Forecasting popup has a 4-tab layout (Calibrate | Demand | Elasticity | Scenarios). Each active choropleth shows a floating legend widget at bottom-left of the map.

### Feature Panel (right)

```
+-----------------------------+
|  Features                   |
|  STATIONS                   |  Per-station rows with editable
|    Station 1         [DEL]  |  names and delete buttons.
|    Station 2         [DEL]  |  Stations can be dragged on the map.
|  LINES                      |  Per-line rows. Click on map to
|    Line 1            [DEL]  |  enter vertex editing mode.
|  ROUTES                     |  Per-route rows. Click on map to
|    Route 1           [DEL]  |  enter waypoint editing mode.
|  POLYGONS                   |  Per-polygon rows. Click on map to
|    Polygon 1         [DEL]  |  enter vertex editing mode.
|  BUFFERS                    |
|    Stations [_0.5_] mi      |  Radius input: default 0.5 mi.
|    Lines    [_0.5_] mi      |  Separate buffer for line features.
|    Routes   [_0.5_] mi      |  Separate buffer for route features.
|  [Import] [Export]          |  Anchored to bottom (flex footer).
+-----------------------------+
```

## Known Issues

See `REVIEW.md` for the full code review. Remaining items not yet addressed:

- No subresource integrity (SRI) hashes on CDN script tags
