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
index.html                  App shell: toolbar, sidebar container, map, feature panel, results modal, script tags
css/
  style.css                 Core layout, toolbar, feature panel, results modal, basemap switcher styles
  sidebar-v2.css            Sidebar panel system styles (scoped under #sidebar), variable checkbox list
js/
  app.js                    Startup, project registry, sidebar panel HTML, multi-variable summary runner, results modal, event wiring
  core/
    utils.js                CSV parsing, number formatting, GEOID normalization, VAR_META (with label/category), getSelectedVars
    sidebar.js              Sidebar panel manager: addPanel, removePanel, toggle, render
    map.js                  MapLibre GL map instance, basemap registry + switcher control, cursor management
    stations.js             Station points, user-defined buffers (default 0.5 mi), union polygon, station drag support
    lines.js                Line drawing (polylines with snap-to-close), line buffers (default 0.5 mi), rubber-band preview, vertex editing
    polygons.js             Polygon drawing (vertex-by-vertex with snap-to-close), rubber-band preview, vertex editing
    editing.js              Feature editing: station click-drag, line/polygon vertex editing with orange handles
    features.js             Right-side feature panel: lists features, editable names, delete buttons
    census.js               TIGERweb geometry queries, ACS data fetch, area-weighted aggregation
    lodes.js                LODES .csv.gz download/upload/parse, block-level employment
    cache.js                Session cache: save/restore/reset via localStorage; JSON import/export
  projects/
    fta-small-starts.js     FTA Small Starts: breakpoint classification, CRE/ESS/LBAR
projects/
  fta-small-starts.html     FTA sidebar HTML fragment (injected into #project-panel)
```

## Conventions

- **No build tools.** Plain `<script>` tags in dependency order. Anyone can read/edit the source directly.
- **Global namespace.** All shared state and functions live on `window.App`. Each module IIFE reads `var App = window.App` and assigns its exports (e.g., `App.fetchTigerwebGeos = fetchTigerwebGeos`).
- **Project-local state stays private.** Variables like `CRE_MAP`, `ESS_POINTS`, `LBAR_SITES` are declared inside the project IIFE closure, not on `App`.
- **Panel-based sidebar.** Sidebar content is registered via `App.sidebar.addPanel()` and rendered on map load. Panel HTML is defined as strings in `app.js`, not hardcoded in `index.html`. Call `render()` once after all panels are registered (avoids destroying event listeners).
- **External libraries via CDN:** MapLibre GL JS, Turf.js, pako (gzip), PapaParse (CSV).

## Script Load Order

Order matters because modules depend on earlier ones:

```
utils.js    (no deps)
sidebar.js  (needs App namespace from utils.js)
map.js      (creates App.map, basemap switcher, cursor handlers)
stations.js (needs App.map, turf)
lines.js    (needs App.map, turf)
polygons.js (needs App.map)
editing.js  (needs App.map, App.stations, App.lines, App.polygons, move/update functions)
features.js (needs App.stations, App.lines, App.polygons, App.removeStation, etc.)
census.js   (needs App.map, App.bboxStringFromFeature, App.getMeta, turf)
lodes.js    (needs App.map, App.bboxStringFromFeature, App.bufferUnionPolygon, pako, turf)
cache.js    (needs App.stations, App.lines, App.polygons, render/rebuild functions)
app.js      (wires everything; registers sidebar panels; defines App.registerProject; calls cache.restore)
<project>   (calls App.registerProject)
```

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

Saves session state (stations, lines, polygons, buffer radii, form selections, LODES filename) to `localStorage` under key `"mat-session"`. Restore runs automatically at end of map load. Save is debounced (500ms) and called after every state mutation. Reset clears localStorage and all app state. LODES data is NOT cached (too large); only the filename is stored as a re-upload hint.

`exportToFile()` serializes current state to a timestamped `.json` file and triggers a browser download. `importFromFile(file)` reads a JSON file (from a hidden `<input type="file">`), validates it, and applies the state — replacing all current features. Both use the same schema as localStorage (`version: 1`).

### app.js
`drawMode`, `registerProject(config)`, `notifyProject()`, `onFeatureDelete()` (hook, see below)

## Project System

Projects are optional domain-specific analyses that plug into the core. A project is **at minimum two files**: a JS file and a main HTML fragment. Projects with complex workflows can declare additional sub-panels, each backed by their own HTML file.

### Registration

A project registers itself at load time by calling:

```js
App.registerProject({
  id: "my-project",
  name: "Human-readable Name",
  panelHTML: "projects/my-project.html",   // main sidebar HTML fragment path

  // Optional: additional collapsible sidebar panels for this project.
  // Each panel's HTML is loaded from htmlFile (same fetch mechanism as panelHTML).
  // Panels are inserted in order between the main project panel (order 20) and LODES (order 30).
  panels: [
    { id: "my-sub",  title: "Sub-panel Title", htmlFile: "projects/my-sub.html", collapsed: true, order: 22 }
  ],

  init: function (core) {
    // Called once after panelHTML and all panel htmlFiles are injected into the DOM.
    // Wire up file upload listeners, build UI, etc.
    // Sub-panel elements are accessible by their IDs at this point.
  },

  update: async function (core) {
    // Called whenever core data changes: station add/remove/clear,
    // summary run, LODES file load/error.
  }
});
```

### The `core` object

Passed to `init()` and `update()`. Provides the project with access to shared state and functions without reaching into `App` directly:

| Key | Type | Description |
|-----|------|-------------|
| `stations` | Array | Current station Point features |
| `buffers` | Array | Current buffer Polygon features |
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

The existing FTA project still accesses `App.*` directly in its internal functions. New projects should prefer `core.*` for cleaner dependency boundaries.

### How to add a new project

1. Create `js/projects/my-project.js` with an `App.registerProject({...})` call
2. Create `projects/my-project.html` with the main sidebar panel markup
3. Optionally create additional `projects/my-sub.html` files for sub-panels and declare them in the `panels[]` array
4. Add `<script src="js/projects/my-project.js"></script>` to `index.html` (after `app.js`)
5. Remove or comment out any other project script tag (one project at a time)

No core code needs to change.

### How to run with no project

Remove the project `<script>` tag from `index.html`. The core app (map, stations, ACS summaries, LODES) works independently.

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

The sidebar is an empty `<div id="sidebar">` populated at runtime by `App.sidebar`. Panels are registered in `app.js` on map load, then `render()` builds the DOM. Each panel has a collapsible header (click to toggle). Panel HTML strings live in `app.js` (station-data, lodes) or are fetched from a project HTML file.

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
|  ▾ Project Name             |  Collapsible panel (order 30)
|  #project-panel             |  Empty <div> filled by the active
|  (injected by project)      |  project's HTML fragment.
+-----------------------------+
```

### Feature Panel (right)

```
+-----------------------------+
|  Features                   |
|  STATIONS                   |  Per-station rows with editable
|    Station 1         [DEL]  |  names and delete buttons.
|    Station 2         [DEL]  |  Stations can be dragged on the map.
|  LINES                      |  Per-line rows. Click on map to
|    Line 1            [DEL]  |  enter vertex editing mode.
|  ROUTES                     |  (placeholder)
|  POLYGONS                   |  Per-polygon rows. Click on map to
|    Polygon 1         [DEL]  |  enter vertex editing mode.
|  BUFFERS                    |
|    Stations [_0.5_] mi      |  Radius input: default 0.5 mi.
|    Lines    [_0.5_] mi      |  Separate buffer for line features.
|  [Import] [Export]          |  Anchored to bottom (flex footer).
+-----------------------------+
```

## Known Issues

See `REVIEW.md` for the full code review. Remaining items not yet addressed:

- No Census API key (moderate: rate-limited without one)
- No subresource integrity (SRI) hashes on CDN script tags
