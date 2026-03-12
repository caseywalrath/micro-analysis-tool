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
- **ACS variable code changes require updates in TWO files.** `utils.js` holds `VAR_META` (labels/categories), but `buffer-summary.js` has three additional structures that must stay in sync: (1) the `CHECKBOX_GROUPS` object used to build sidebar checkbox groups, (2) the matching local group array (e.g. `COMM_GROUP`), and (3) the `DENOM_MAP` entry for percentage calculation. Updating `utils.js` alone will cause the old code to appear as a raw label with no category in results.
## Overview

Browser-based geospatial analysis tool. Pure front-end (no build step, no backend, no npm). Open `index.html` in a browser and it works. All data stays client-side; Census APIs are called directly.

## File Structure

```
index.html                  App shell: toolbar, sidebar, map, feature panel, module popup container, script tags
css/
  style.css                 Core layout, toolbar, feature panel, module popup, floating widgets, basemap switcher, BAS styles (.bas- prefix), TPI styles, RF styles (.rf- prefix), FTA styles (.fta- prefix), pill rating colors
  sidebar-v2.css            Sidebar panel system styles (scoped under #sidebar), variable checkbox list, section labels
js/
  app.js                    Startup, module registry, sidebar panel HTML (Data Inputs), event wiring. Note: CHECKBOX_GROUPS, DENOM_MAP, and runSummary() have moved to buffer-summary.js.
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
    buffer-summary.js       Buffer-Area Summary module: CHECKBOX_GROUPS, MANDATORY_VARS, DENOM_MAP, expandGroups, runSummary (moved from app.js). Registered as popup-based module.
    fta-small-starts.js     FTA Small Starts: breakpoint classification, CRE/ESS/LBAR, popup-based 2-tab UI (Ratings | Data Inputs), session persistence, CSV export
    tpi-scoring.js          TPI scoring engine: 9-factor definitions, batch ACS fetch, LODES aggregation, quintile normalization, composite scoring
    transit-propensity.js   TPI module: popup-based 2-column UI (Settings | Results), weights modal overlay, feature checklist (normalization pool), analysis corridor dropdown, scrollable geography list with expandable factor breakdowns, choropleth rendering, hover tooltips, floating legend (auto-shown on run), GeoJSON/CSV export, stale detection
    ridership-scoring.js    Ridership scoring engine: corridor CDI computation, per-route CDI extraction, system-wide demand orchestration, CSV route matching, segment analysis, service type presets, elasticity formulas, scenario builder, ratio/OLS calibration (window.RidershipModel namespace)
    ridership-forecasting.js  Ridership Forecasting module: 4-tab popup (Calibrate | Demand | Elasticity | Scenarios), 3-step calibration workflow, corridor dropdown, choropleth + segment map, scenario comparison table, GeoJSON/CSV/JSON export; shared-pool normalization mode for cross-system calibration
projects/
  buffer-summary-popup.html   Buffer-Area Summary popup body: settings (geography, year, apportion) + results table
  fta-small-starts-popup.html  FTA popup body: 2-tab layout (Ratings | Data Inputs); Ratings tab has 2-column layout (settings + 5 rating cards); Data Inputs tab has CRE/ESS/LBAR file uploads with column mapping selects
  fta-small-starts.html     FTA sidebar HTML fragment (legacy, replaced by popup version)
  transit-propensity-popup.html  TPI popup body: 2-column layout (Settings | Results); Settings column has geography/year selectors, apportion toggle, feature checklist (normalization pool), analysis corridor dropdown, Adjust Weights button (opens modal overlay with 9 factor sliders + Confirm/Cancel/Reset), Analyze System button; Results column has scrollable geography list with expandable per-geo factor breakdowns, summary stats, export buttons; LODES warning icon (⚠) next to ACS Year selector
  transit-propensity.html   TPI sidebar panel (legacy, replaced by popup version)
  tpi-weights.html          TPI weight sliders (legacy, merged into popup)
  tpi-legend.html           TPI legend: 5-class Blues color swatches (reused by floating widget)
  ridership-forecasting-popup.html  RF popup body: 4-tab layout (Calibrate first), 3-step calibration workflow UI (system analysis → CSV upload → match/calibrate); "Adjust Weights" button above "Analyze System" opens an in-popup modal overlay with 9 factor weight sliders (Confirm / Cancel / Reset to Defaults / Copy From TPI); expandable per-route factor breakdowns with quintile bars; headway normalization note (`rfCalibHeadwayNote`); shared-pool refit note (`rfCalibSharedPoolNote`); LODES warning icons (⚠) next to ACS Year in Calibrate and Demand tabs (shows tooltip when LODES not loaded); corridor dropdown in Demand tab, CDI info button (ⓘ toggle), segment breakdown, "Shared pool normalization" checkbox (`rfSharedPoolMode`) with info tooltip (`rfSharedPoolTooltip`) in Demand tab feature section, elasticity sliders — frequency elasticity (`rfFreqElastSlider`/`rfFreqElastValue`, 0.1–1.0, default 0.50) and service span elasticity (`rfSpanElastSlider`/`rfSpanElastValue`, 0.1–1.0, default 0.70, typical range 0.5–0.9) — in Elasticity tab left column; service type premium sliders (`rfServicePremLow`/`rfServicePremLowVal` and `rfServicePremHigh`/`rfServicePremHighVal`, 0–150% range) in Elasticity tab right column (replaces static Frequency/Speed/Mode breakdown), baseline uncertainty slider (`rfBaseUncertSlider`/`rfBaseUncertValue`, 0–60% range, default 25%) in Elasticity tab with "Baseline Projection" result card (`rfBaselineBand`) showing pre-service uncertainty band, 4-column scenario grid (A|B|C|D), comparison table
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
- **Tabbed popup layout.** Multi-step analysis modules (e.g., Ridership Forecasting, FTA Small Starts) use a tab bar (`<div class="rf-tabs">` / `<div class="fta-tabs">` with `[data-tab]` buttons) and tab content panels toggled via a `switchTab(id)` function in the module JS. State is saved to closure variables on tab switch; the form is not reset.
- **Inline info buttons.** Contextual help uses a small `<button class="rf-info-btn">ⓘ</button>` element adjacent to the label, wired in `init()` to toggle a sibling explanation `<div>` via `style.display`. No tooltip libraries needed.
- **CSS namespacing.** TPI styles use `.tpi-` prefix. Ridership Forecasting styles use `.rf-` prefix. FTA Small Starts styles use `.fta-` prefix. Rating pill colors use `.pill.high` through `.pill.low`. All live in `css/style.css`.
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
  buffer-summary.js     (needs App namespace, App.cache; registers Buffer-Area Summary module; contains CHECKBOX_GROUPS, DENOM_MAP, runSummary)
  fta-small-starts.js   (needs App namespace, App.cache; registers FTA Small Starts module; popup-based 2-tab UI)
  tpi-scoring.js        (needs App namespace, turf; defines window.TPI)
  transit-propensity.js (needs TPI, App.registerModule, App.popup, App.map, App.renderCensusOverlay)
  ridership-scoring.js  (needs window.TPI, App namespace, turf; defines window.RidershipModel)
  ridership-forecasting.js (needs RidershipModel, TPI, App.registerModule, App.popup, App.map, App.renderCensusOverlay)
```

**Active modules:** Buffer-Area Summary is enabled (popup-based, settings + results table). TPI is enabled (popup-based, 2-column). FTA Small Starts is enabled (popup-based, 2-tab). Ridership Forecasting is enabled (popup-based, 4-tab).

## App Namespace (Public API)

### utils.js
`setStatus(s)`, `parseCSV(text)`, `fillSelect(el, opts, placeholder)`, `enableSelect(el, bool)`, `toNumberSafe(v)`, `normalizeTractGEOID(raw)`, `guessHeader(headers, candidates)`, `VAR_META`, `getMeta(code)`, `setAggUI(meta)`, `formatValue(val, meta)`, `getSelectedVars()`, `mapToObj(map)`, `objToMap(obj)`, `nestedMapToObj(outerMap)`, `nestedObjToMap(obj)`

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
`cache.save()`, `cache.restore()`, `cache.reset()`, `cache.exportToFile()`, `cache.importFromFile(file)`, `cache.registerModule(id, handlers)`, `cache.STORAGE_KEY`

Saves session state (stations, lines, routes, polygons, buffer radii, form selections, LODES filename) to `localStorage` under key `"mat-session"`. Routes store full geometry + waypoints; no re-routing needed on restore. Restore runs automatically at end of map load. Save is debounced (500ms) and called after every state mutation. Reset clears localStorage and all app state. LODES data is NOT cached (too large); only the filename is stored as a re-upload hint.

`exportToFile()` serializes current state to a timestamped `.json` file and triggers a browser download. `importFromFile(file)` reads a JSON file (from a hidden `<input type="file">`), validates it, and applies the state — replacing all current features. Both use the same schema as localStorage (`version: 1`).

`registerModule(id, { collect(mode), apply(data) })` — analysis modules call this at load time to opt into session persistence. `collect(mode)` returns a serializable object; `mode` is `"light"` (localStorage, skip heavy geometry) or `"full"` (file export, includes geos for choropleth restore). `apply(data)` restores state from a previously collected object. Module state is stored under `state.moduleState[moduleId]` in the JSON schema. The RF module registers as `"rf"` and persists weights, scenario forms, calibration metadata, per-route CDI, system demand result, shared-pool mode flag, and baseline uncertainty percentage (TPI geographies included in full export only). RF session schema is at **v3** (v1/v2 restored with backward-compat migration; v3 adds `sharedPoolMode`; `baselineUncertaintyPct` added gracefully — defaults to 0.25 when absent, no schema version bump needed).

### popup.js
`popup.open(moduleId, modules, buildCore)`, `popup.close()`, `popup.isOpen()`, `popup.currentModuleId()`, `popup.showFloatingWidget(id, htmlFile, options)`, `popup.hideFloatingWidget(id)`, `popup.removeFloatingWidget(id)`, `popup.wire(modules, buildCore)`

Floating widget options: `{ position: "bottom-left"|"bottom-right"|"top-left"|"top-right", width: px, title: string }`

### app.js
`drawMode`, `registerModule(config)`, `registerProject(config)` (alias for registerModule), `notifyProject()`, `onFeatureDelete()` (hook, see below)

### tpi-scoring.js (window.TPI namespace, not on App)
`TPI.FACTORS` (9-factor array with id, label, weight, acsCodes, compute functions), `TPI.batchFetchACS(geoLevel, year, geoids)`, `TPI.aggregateLodesToGeo(lodesData, geoLevel, geoids)`, `TPI.computeQuintiles(values)`, `TPI.computeComposite(factorScores, weights)`, `TPI.computeTPI(options)` (full pipeline: fetch → normalize → score; accepts optional `options.unionPolygon` to restrict the study area instead of using `App.bufferUnionPolygon()`), `TPI.rescoreFromRaw(rawValues, weights, geoids)` (instant re-score from cached data)

**Default factor weights** (sum = 100): Population Density 35, Employment Density 35, Zero-Vehicle HH 5, Low-Income % 5, Senior 65+ % 5, Disability % 5, Minority % 5, Youth <18% 0, LEP % 5. These are shared defaults for both TPI and RF modules (each module stores its own independent copy in `_weights`).

**Tract-level fallbacks** (within `TPI.computeTPI()`): When `geoLevel === "bg"` and `apportionByArea` is false, TPI runs two fallback passes: (1) *static* — factors flagged `tractOnly: true` (currently only LEP / C16001) are always fetched at tract level and mapped down to block groups via parent-tract GEOID slicing; (2) *dynamic* — after computing raw values, any ACS factor that produced zero finite values at BG level is automatically re-fetched at tract level and remapped. Both fallbacks are skipped when `apportionByArea: true`. All downstream modules (RF included) benefit automatically since they delegate to `TPI.computeTPI()`.

### transit-propensity.js (analysis module)
Registers module `"transit-propensity"` as a popup-based analysis. Opens in a 2-column popup (960px wide): left Settings column (240px fixed) and right Results column (flex). All state is private to the IIFE closure. DOM writes are guarded with `isPopupVisible()` so `update()` can safely fire when the popup is closed. LODES warning icon (`#tpiLodesWarnBtn`, ⚠ button) shows/hides next to the ACS Year selector: shown when `App.lodesData` is null (Employment factor excluded), hidden when LODES is loaded. Visibility updated in `onOpen()` and `update()`.

**Settings column (left):** Geography level dropdown, ACS Year selector (with LODES warning), apportion-by-area toggle, **TPI Features checklist** (checkboxes to select which routes/lines define the normalization pool — only selected features' union polygon is used for quintile computation), **Analysis Corridor dropdown** (filters the geography list display to a specific route/line without re-running the computation), **"Adjust Weights" button** (opens a modal overlay with 9 factor weight sliders; Confirm copies `_pendingWeights` → `_weights` and triggers instant rescore, Cancel discards, Reset to Defaults restores default weights), and "Analyze System" button.

**Results column (right):** Status indicator, scrollable geography list (each row shows geo GEOID + composite TPI score; click to expand and see per-factor quintile bars), aggregate TPI Score for the selected corridor, summary stats (geographies scored, factors included), footnotes (LODES status, apportion mode), GeoJSON and CSV export buttons. Legend auto-shows on the map when analysis runs (no manual "Show Legend" button).

**Internal functions:** `runTPI()`, `runInstantRescore()`, `renderChoropleth(result)`, `clearChoropleth()`, `displayGeographyList(result)`, `updateSummaryStats()`, `updateFootnotes()`, `updateExportButtons()`, `exportGeoJSON()`, `exportCSV()`, `markStale()`, `buildFeatureChecklist()`, `buildCorridorDropdown()`, `getFeatureFilter()`, `buildUnionFromFilter()`, `getGeosInCorridor()`, `openWeightsModal()`, `closeWeightsModal()`, `resetModalToDefaults()`, `syncSlidersToWeights()`, `onModalSliderChange()`, `onModalNumberChange()`, `updateModalWeightSum()`.

**Module-local state:** `_tpiFeatureFilter` (which features selected for normalization pool), `_selectedCorridor` ("all" or "route:N"/"line:N"), `_pendingWeights` (temporary copy while weights modal is open), `_weights`, `_lastResult`, `_stale`, `_running`, `_initialized`, `_apportionByArea`.

**Public API (on `App`):** `App.getTpiWeights()` — returns a shallow copy of TPI's current `_weights` object. Used by the RF module's "Copy From TPI" button to read TPI's live weight settings without tight coupling.

### fta-small-starts.js (analysis module, no public API)
Registers module `"fta-small-starts"` as a popup-based analysis. Opens in a 2-tab popup (960px wide). All state is private to the IIFE closure. DOM writes are guarded with `isPopupVisible()`. All DOM element IDs use `fta` prefix (e.g., `ftaGeoLevel`, `ftaYearSelect`, `ftaCreFile`) to avoid collisions with other modules.

**Tab 1 – Ratings**: 2-column layout. Left column: geography level dropdown, ACS Year selector, "Compute Breakpoints" button, loaded-data indicators (CRE/ESS/LBAR status). Right column: 5 rating cards (`bpItem` class) for Cost Effectiveness (CRE), Existing Ridership (ESS), Transit-Supportive Land Use (LBAR), Mobility Improvement, and Congestion Relief — each showing a color-coded pill (High/Medium-High/Medium/Medium-Low/Low) with numeric value and classification range. CSV export button below ratings.

**Tab 2 – Data Inputs**: 2-column layout. Left column: CRE file upload (3 column selects: route name, annualized cost, new annual riders) and ESS file upload (2 column selects: route name, avg weekday boardings). Right column: LBAR file upload (4 column selects: block GEOID, residential density, employment density, CBD dummy) with county FIPS input and map layer toggle.

**Pill color coding:** `.pill.high` (green), `.pill.mh` (blue), `.pill.med` (yellow), `.pill.ml` (orange), `.pill.low` (red) — defined in `css/style.css`.

**Internal functions:** `_doUpdateBreakpointRatings()` (async, computes all 5 ratings from uploaded data + ACS), `computeCRE()`, `computeESS()`, `computeLbarRatio()`, `switchTab()`, `updateDataIndicators()`, `exportRatingsCSV()`, `restoreRatingsDisplay()`, `saveFtaState()`, `restoreFtaState()`.

**Module-local state:** `CRE_MAP`, `ESS_POINTS`, `LBAR_SITES` (uploaded data), `_lastRatings` (computed rating results for session persistence), `_initialized`, `_activeTab`, `_bpRunning`, `_bpQueued` (concurrency guard). Session persistence via `App.cache.registerModule("fta", ...)` — persists computed ratings only, not raw uploaded file data.

### ridership-scoring.js (window.RidershipModel namespace, not on App)
Scoring engine for the Ridership Forecasting module. Depends on `window.TPI` for demand computation.

`RidershipModel.SERVICE_TYPES` — array of 4 service type presets (local_bus, enhanced_bus, limited_stop, brt), each with `id`, `label`, default operating parameters (`defaultSpeed`, `defaultHeadway`, `defaultSpan`, `defaultStopSpacing`), and a single combined `servicePremium: { low, high }` (fractions; mid derived as average). Default values: local_bus 0/0, enhanced_bus 0.15/0.35, limited_stop 0.15/0.30, brt 0.30/0.65. User-adjusted values are stored in `_servicePremiums` in the module closure and passed via `customServicePremium` param to `applyElasticity`.

`RidershipModel.getServiceType(id)` — returns a service type preset by id.

`RidershipModel.computeCorridorDemand(options)` — wraps `TPI.computeTPI()`, then computes the Corridor Demand Index (CDI) as a population-weighted average of TPI composite scores. Options: `{ geoLevel, year, weights, lodesData, apportionByArea, segmentLengthMiles, onProgress }`. Returns `{ tpiResult, corridorCDI: { value, scored, total }, segments: [...], classification }`. Used in uncalibrated mode only; calibrated mode bypasses this and calls `computeSegments()` directly on cached TPI data.

`RidershipModel.computeSegments(tpiResult, segmentMiles, selectedCorridor)` — segments drawn routes and lines into equal-length chunks, computes a population-weighted CDI for each segment by intersecting chunk buffers with already-fetched TPI geographies. Pure turf.js — no Census API calls. `selectedCorridor` is `"route:N"` / `"line:N"` (only that feature) or `"all"` / falsy (all drawn routes and lines). Segment objects: `{ featureType, routeIndex, segmentIndex, cdi, classification, geoCount, geometry, bufferGeometry, lengthMiles }`.

`RidershipModel.classifyCDI(score)` — returns `{ label, level, cssClass }` for a numeric CDI (High ≥4, Medium 3–3.9, Low-Medium 2–2.9, Low <2).

`RidershipModel.getRouteLength()` — returns total length in miles of all drawn routes via `turf.length()`.

`RidershipModel.computeFrequencyEffect(baseHeadway, newHeadway, elasticity)` — computes the frequency effect multiplier: `(newFreq / baseFreq) ^ elasticity` where `freq = 60 / headway`. Used internally by `applyElasticity()` and externally by the Calibrate tab for headway normalization of observed ridership.

`RidershipModel.computeSpanEffect(baseSpan, newSpan, elasticity)` — computes the service span effect multiplier: `(newSpan / baseSpan) ^ elasticity`. `baseSpan` is the reference span in hours (14h — local bus default); `newSpan` is the scenario span. Default elasticity 0.7 (user-adjustable via `_spanElasticity`; typical range 0.5–0.9 per Currie & Loader 2009, TCRP synthesis). Applied per-scenario in the Scenarios tab; not applied in the Elasticity tab (which is headway/service-type focused). Returns 1 if either span is non-positive.

`RidershipModel.applyElasticity(baseCDI, params)` — applies frequency elasticity and service type premiums to produce `{ low, mid, high }` ridership values. When `baseCDI` is `1.0`, returns pure multipliers (used by Elasticity/Scenarios tabs to separate service effects from baseline uncertainty). Frequency effect formula: `(newFreq / oldFreq) ^ elasticity` where `freq = 60 / headwayMinutes`. Combined multiplier: `freqEffect × (1 + servicePremium[level])` where mid = (low+high)/2. Accepts `customServicePremium: { low, high }` param to override the preset values. Returns `{ low, mid, high, freqEffect, serviceType }`.

`RidershipModel.applyBaselineUncertainty(baseMid, pct)` — applies a symmetric model uncertainty band around a calibrated baseline ridership estimate. Input: `baseMid` (calibrated baseline projection), `pct` (0–1, e.g. 0.25 for ±25%). Returns `{ low: max(0, baseMid*(1-pct)), mid: baseMid, high: baseMid*(1+pct) }`. Returns all zeros if `baseMid` is non-finite or ≤ 0. Used by the Elasticity and Scenarios tabs: the baseline band is computed once, then multiplied element-wise by service effect multipliers from `applyElasticity(1.0, ...)` to produce the final Conservative/Moderate/Optimistic ridership range.

`RidershipModel.buildScenario(params)` — computes operating metrics for one scenario. Key formulas: `vehiclesNeeded = ceil(2 × routeLength / avgSpeed / (headway/60))`, `revHoursPerDay = vehiclesNeeded × span`, `annualRevHours = revHoursPerDay × serviceDays`, `annualCost = annualRevHours × costPerRevHour`. Ridership multiplies the baseline uncertainty band × frequency+service multipliers (from `applyElasticity`) × span effect (from `computeSpanEffect`, baseline span 14h). Returns full scenario object with low/mid/high ridership, cost/boarding, boardings/rev-hr.

`RidershipModel.compareScenarios(scenarios[])` — builds scenario objects for up to 4 scenarios; returns array.

`RidershipModel.calibrateRatio(rows, demandColKey, ridershipColKey)` — ratio-based calibration: `factor = mean(observed / CDI)`. Returns `{ factor, n, rSquared, method: "ratio" }`.

`RidershipModel.calibrateRegression(rows, demandColKey, ridershipColKey)` — OLS regression: `ridership = intercept + slope × CDI`. Returns `{ factor (=slope), intercept, n, rSquared, method: "regression" }`. Requires n ≥ 3.

`RidershipModel.computePerRouteCDI(tpiResult, featureFilter)` — Takes a system-wide TPI result and extracts a CDI score for each individual drawn route and line. Optional `featureFilter` parameter `{ routeIndices: [...], lineIndices: [...] }` restricts which features are processed (null = all features, backward compatible). Uses population-weighted intersection (same pattern as segment analysis) against each feature's own buffer polygon. Returns array of `{ name, featureType ("route"|"line"), featureIndex, cdi, classification, geoCount, lengthMiles, factorBreakdown, compositeRange }`. `factorBreakdown` is an object `{ factorId: avgQuintileScore }` showing population-weighted average quintile per factor for that route. `compositeRange` is `{ min, max }` showing the spread of composite TPI scores across overlapping geographies. These enable the Calibrate tab's expandable factor breakdown display. Enables meaningful CDI variation across corridors (urban routes score high, suburban routes score low), which is required for valid calibration.

`RidershipModel.computeSystemDemand(options)` — Orchestrator that runs `TPI.computeTPI()` once, then computes both the system-wide CDI and per-route CDI array. Options: `{ geoLevel, year, weights, lodesData, apportionByArea, onProgress, unionPolygon, featureFilter }`. When `unionPolygon` is provided, it restricts the TPI study area (passed through to `TPI.computeTPI()`). When `featureFilter` is provided, only the specified routes/lines are included in per-route CDI computation. Returns `{ tpiResult, systemCDI, routeCDIs, geoLevel, year }`.

`RidershipModel.buildUnionFromFeatures(featureFilter)` — Builds a turf union polygon from the buffers of specified features. `featureFilter`: `{ routeIndices: [...], lineIndices: [...] }`. Returns a union Polygon/MultiPolygon, or null. Used to construct a custom study area for `TPI.computeTPI()` when analyzing a subset of drawn features.

`RidershipModel.matchRoutesToCSV(routeCDIs, csvRows, nameCol)` — Case-insensitive exact name matching between drawn features (from `computePerRouteCDI`) and CSV rows. Returns `{ matched: [{ csvRow, routeCDI, csvRowIndex }], unmatched: [...], duplicateWarnings: [] }`. Used in the Calibrate tab "Match Routes" step.

### ridership-forecasting.js (analysis module, no public API)
Registers module `"ridership-forecasting"` as a popup-based analysis. Opens in a 4-tab popup (960px wide). All state is private to the IIFE closure. DOM writes are guarded with `isPopupVisible()`. LODES warning icons (`#rfCalibLodesWarnBtn` in Calibrate tab, `#rfDemandLodesWarnBtn` in Demand tab) show/hide next to the ACS Year selectors: shown when `App.lodesData` is null (Employment factor excluded), hidden when LODES is loaded. Visibility updated in `onOpen()` (every popup open) and `update()` (when LODES uploaded/cleared while popup open) via `updateLodesWarnings()` helper.

**Tab 1 – Calibrate** (now first): 3-step gated workflow. Step 1: "Analyze System" — geography/year settings, a **feature checklist** (checkboxes to select which routes/lines to include in the calibration system — only selected features contribute to quintile normalization and CDI scoring), an **"Adjust Weights" button** (opens a modal overlay with 9 factor weight sliders; buttons: Confirm / Cancel / Reset to Defaults / Copy From TPI), and the "Analyze System" button; calls `RidershipModel.computeSystemDemand()` with the selected feature filter and custom union polygon, and shows a per-route CDI score table with **expandable factor breakdowns** (click any route to see per-factor quintile bars with green/red coloring relative to system averages). Step 2: "Upload CSV" — file picker, auto-column detection via `App.guessHeader()`, "Match Routes" button; calls `RidershipModel.matchRoutesToCSV()` and shows green/red match results. Step 3: "Run Calibration" — uses matched (CDI, ridership) pairs (one per route) for ratio-based or OLS regression calibration. **Headway normalization**: if a headway column is mapped in the CSV, observed ridership is divided by `computeFrequencyEffect(refHeadway=30, routeHeadway, elasticity)` before fitting, stripping frequency variation so the calibration factor isolates pure demand; a blue `.rf-note` info box shows normalization details. When shared-pool mode is active, a second `.rf-note` (`rfCalibSharedPoolNote`) confirms the calibration was auto-refitted from shared-pool CDI values. Each step is unlocked by completing the previous one. Calibration factor persists across tabs. Calibration data (coefficients + weights + per-route CDI + `baselineUncertaintyPct`) is exportable/importable as standalone v3 JSON (v2 also supported on import; missing `baselineUncertaintyPct` defaults to 0.25). RF weights are independent from TPI weights; `_weights` is stored in the module closure and defaults to `TPI.getDefaultWeights()`.

**Tab 2 – Demand**: "Target System" section at top with a **"Same system as calibration" toggle** and a **feature checklist** for selecting demand system features. When "same system" is checked, the feature checklist (including the shared-pool checkbox) is hidden and calibration TPI data is reused (no Census API calls). When unchecked, the feature section is shown and one of three paths runs: **(A)** same system (reuse calibration TPI); **(B-shared)** `_sharedPoolMode=true` — `runSharedPoolAnalysis()` runs one combined TPI covering both calibration and demand features' union polygon with `featureFilter:null`, then partitions `result.routeCDIs` by filter into `_sharedCalibPerRouteCDI` and `_demandPerRouteCDI`, and auto-refits `_calibration` via `refitCalibrationFromCDI()`; **(B)** separate pool — fresh `computeSystemDemand()` scoped to selected demand features only. **"Shared pool normalization" checkbox** (`rfSharedPoolMode`): visible when "Same system" is unchecked, defaults to checked when the user unchecks "Same system" — recommended for cross-system calibration where absolute density levels differ. An ⓘ info button toggles an inline explanation. Below the system section, a corridor dropdown ("Analysis corridor") lets the user select a specific route/line or the system-wide CDI. Segment analysis calls `RidershipModel.computeSegments()` on the active TPI result — scoped to the selected corridor. If neither calibration nor demand system analysis has been run, `computeCorridorDemand()` is called (full TPI fetch, legacy uncalibrated behavior). Renders CDI choropleth on map (Blues color ramp), segment overlay, and floating legend widget (`projects/ridership-legend.html`). CDI info button (ⓘ) toggles inline explanation. GeoJSON and CSV export enabled after analysis.

**Tab 3 – Elasticity**: Service type dropdown, baseline/proposed headway inputs, frequency elasticity slider (0.1–1.0, default 0.5), **service span elasticity slider** (`rfSpanElastSlider`, 0.1–1.0, default 0.70; typical range 0.5–0.9), **baseline uncertainty slider** (0–60%, step 5, default 25%). Note: span elasticity is stored in `_spanElasticity` but span effect is only applied in the Scenarios tab (which has an explicit span input per scenario); the Elasticity tab displays headway and service-type effects only. Right column: **user-adjustable service type premium sliders** (Conservative % and Optimistic %, 0–150% range, step 5) that store per-service-type values in `_servicePremiums` — switching service types loads that type's saved values; mid is derived as the average. Uses `getActiveCDI()` (see below) so the CDI automatically reflects the selected corridor. Calculation flow: (1) compute `baseMid` using the full calibration formula `max(0, CDI×factor×length, (intercept+CDI×factor)×length)`, (2) apply `RidershipModel.applyBaselineUncertainty(baseMid, _baselineUncertaintyPct)` to get `{low, mid, high}` baseline band, (3) extract pure service multipliers via `RidershipModel.applyElasticity(1.0, params)` with `customServicePremium: _servicePremiums[stId]`, (4) multiply aligned: `finalLow = baseBand.low × mult.low`, etc. Displays two result cards: "Baseline Projection (before service effects)" showing the uncertainty band, and "Projected Ridership (with service effects)" showing the final Conservative / Moderate / Optimistic range. Recalculates instantly on any input change (no API calls).

**Tab 4 – Scenarios**: 4-column side-by-side grid (A|B|C|D), each column containing identical input fields (name, service type, headway, span, speed, cost/rev-hr, service days). All 4 scenarios are visible simultaneously — no sub-tabs. Input IDs use `_0`/`_1`/`_2`/`_3` suffixes. Uses `getActiveCDI()` for the active corridor CDI. Applies baseline uncertainty band once (`applyBaselineUncertainty`), then for each scenario extracts pure service multipliers via `applyElasticity(1.0, ...)` and span effect via `computeSpanEffect(14, scenarioSpan, _spanElasticity)`, and multiplies all three aligned (`finalLow = baseBand.low × serviceMult.low × spanEffect`, etc.). "Build Scenarios" calls `RidershipModel.buildScenario()` for each and renders a comparison table with mid rows highlighted. CSV and JSON export enabled after build (exports include `baselineUncertaintyPct` for reproducibility).

**`getActiveCDI()`** (internal helper): Returns the CDI value for the currently selected corridor. Prefers the demand context (`_demandPerRouteCDI`) over the calibration context (`_perRouteCDI`). Falls back through `_demandSystemResult.systemCDI`, `_systemResult.systemCDI`, then `_lastResult.corridorCDI`. This ensures Elasticity and Scenarios tabs use CDI values from the target system's independent normalization pool when available.

**Module-local state**: `_lastResult` (legacy demand result from Demand tab), `_systemResult` (calibration-context result from `computeSystemDemand()`), `_perRouteCDI` (calibration-context per-route CDI array), `_calibFeatureFilter` (which features selected for calibration), `_demandSystemResult` (demand-context TPI + CDI results; in shared-pool mode this IS the shared result), `_demandPerRouteCDI` (demand-context per-route CDI; in shared-pool mode filtered from shared result), `_demandFeatureFilter` (which features selected for demand), `_demandUseSameSystem` (boolean, reuse calibration TPI for demand), `_sharedPoolMode` (boolean, use combined calibration+demand normalization pool), `_sharedCalibPerRouteCDI` (calibration-context per-route CDI filtered from shared pool result), `_sharedSystemResult` (the full shared-pool TPI result; same object as `_demandSystemResult` when shared pool ran), `_matchResult` (CSV match result), `_selectedCorridor` ("all" or "route:N"/"line:N"), `_calibration` (calibration coefficients; when headway-normalized includes `headwayNormalized`, `refHeadway`, `normElasticity`, `headwayNormCount`; when refitted from shared pool includes `sharedPoolMode: true`), `_calibData` (uploaded CSV rows), `_baselineUncertaintyPct` (number 0–1, default 0.25; ±% model uncertainty applied to calibrated baseline before service multipliers), `_spanElasticity` (number 0.1–1.0, default 0.70; power-curve exponent for service span effect applied in Scenarios tab; user-adjustable via `rfSpanElastSlider`; persisted in session cache), `_servicePremiums` (object keyed by service type id, each `{ low, high }` fraction; user-adjustable via sliders, defaults mirror `SERVICE_TYPES.servicePremium`; persisted in session cache and calibration export), `_normalizeByLength` (boolean, scale ridership by corridor length), `_scenarios` (array of 4 scenario param sets), `_activeScenario`, `_stale`, `_calibStale`, `_demandStale`, `_running`, `_initialized`, `_apportionByArea`, `_activeTab`, `_weights` (independent factor weights, defaults to `TPI.getDefaultWeights()`), `_pendingWeights` (temporary copy while the Adjust Weights modal is open).

**Internal helpers** (ridership-forecasting.js, not on RidershipModel): `combineFeatureFilters(a, b)` — unions two feature filters (null = all features; either null → result is null); `filterRouteCDIs(allRouteCDIs, filter)` — filters a routeCDIs array to entries matching a feature filter; `refitCalibrationFromCDI(calibPerRouteCDI)` — re-runs the calibration fit from `_matchResult` data using updated CDI values from the shared pool, returns a new calibration object with `sharedPoolMode: true`, or null if insufficient data; `runSharedPoolAnalysis(geoLevel, year, textEl)` — orchestrates the shared-pool path: combines filters, builds union, calls `computeSystemDemand` once, partitions results, auto-refits calibration; `updateLodesWarnings()` — shows/hides LODES warning icons (⚠) based on `App.lodesData` state (called from `onOpen()` and `update()`).

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

The FTA module still accesses `App.*` directly in its internal computation functions. New modules should prefer `core.*` for cleaner dependency boundaries.

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

The sidebar is an empty `<div id="sidebar">` populated at runtime by `App.sidebar`. Panels are registered in `app.js` on map load, then `render()` builds the DOM. Each panel has a collapsible header (click to toggle). Panel HTML strings live in `app.js` (Data Inputs) or are built from registered modules (Analysis).

```
+-----------------------------+
|  ▾ Data Inputs              |  Collapsible panel (order 10)
|  Census                     |  Section header: variable checkboxes
|    Select all / Clear all   |  grouped by: Demographics, Equity,
|    checkbox variables       |  Travel, Housing, Employment (LODES)
|  Employment (LODES)         |  LODES checkbox, Download/Add State/
|    Download / Add State     |  Clear All buttons, file picker
|  PPACG Pop Projection       |  Projection year, Upload CSV, Clear
+-----------------------------+
|  ▾ Analysis                 |  Collapsible panel (order 30)
|  [Buffer-Area Summary]      |  Button: opens BAS popup (settings + results table)
|  [Transit Propensity Index] |  Button: opens TPI popup (2-column layout)
|  [FTA Small Starts]         |  Button: opens FTA popup (2-tab layout)
|  [Ridership Forecasting]    |  Button: opens RF popup (4-tab layout)
+-----------------------------+
```

Clicking an analysis module button opens a popup window over the map. The Buffer-Area Summary popup contains geography/year settings and a results table. The TPI popup has a 2-column layout (Settings | Results) with an Adjust Weights modal overlay. The FTA Small Starts popup has a 2-tab layout (Ratings | Data Inputs). The Ridership Forecasting popup has a 4-tab layout (Calibrate | Demand | Elasticity | Scenarios). Each active choropleth shows a floating legend widget at bottom-left of the map.

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
