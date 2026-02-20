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
  style.css                 Core layout, toolbar, feature panel, results modal, module popup, floating widgets, basemap switcher, TPI styles
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
projects/
  fta-small-starts.html     FTA sidebar HTML fragment (legacy, kept for future popup migration)
  transit-propensity-popup.html  TPI popup body: 3-column layout (Weights | Results | Actions)
  transit-propensity.html   TPI sidebar panel (legacy, replaced by popup version)
  tpi-weights.html          TPI weight sliders (legacy, merged into popup)
  tpi-legend.html           TPI legend: 5-class Blues color swatches (reused by floating widget)
```

## Conventions

- **No build tools.** Plain `<script>` tags in dependency order. Anyone can read/edit the source directly.
- **Global namespace.** All shared state and functions live on `window.App`. Each module IIFE reads `var App = window.App` and assigns its exports (e.g., `App.fetchTigerwebGeos = fetchTigerwebGeos`).
- **Module-local state stays private.** Variables like `CRE_MAP`, `ESS_POINTS`, `LBAR_SITES` (FTA) and `_lastResult`, `_stale`, `_running` (TPI) are declared inside the module IIFE closure, not on `App`. The TPI scoring engine uses a separate `window.TPI` namespace for its public API.
- **Panel-based sidebar.** Sidebar content is registered via `App.sidebar.addPanel()` and rendered on map load. Panel HTML is defined as strings in `app.js`, not hardcoded in `index.html`. Call `render()` once after all panels are registered (avoids destroying event listeners).
- **Analysis popups.** Analysis modules open in popup windows (not the sidebar). The popup system (`App.popup`) handles HTML loading, init/open/close lifecycle, and Escape key. Floating widgets (like the TPI legend) persist on the map independently of the popup.
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
  fta-small-starts.js (needs App namespace; registers as disabled module)
  tpi-scoring.js    (needs App namespace, turf; defines window.TPI)
  transit-propensity.js (needs TPI, App.registerModule, App.popup, App.map, App.renderCensusOverlay)
```

**Active modules:** All analysis modules load simultaneously. TPI is enabled (popup-based). FTA Small Starts is registered but disabled (button shown grayed out).

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
|  [FTA Small Starts] (gray)  |  Button: disabled (coming soon)
+-----------------------------+
```

Clicking an analysis module button opens a popup window over the map. The TPI popup has a 3-column layout (Weights | Results | Actions). A floating legend widget appears at bottom-left of the map when the choropleth is active.

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

- No Census API key (moderate: rate-limited without one)
- No subresource integrity (SRI) hashes on CDN script tags
