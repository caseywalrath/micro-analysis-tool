# Changelog

All notable changes to this project are documented here. Entries are grouped by session date. Most recent sessions are listed first.

---

## 2026-02-20

### Transit Propensity Index (TPI) — Full Implementation

Added a new project plugin that computes a composite Transit Propensity Index for all census tracts or block groups intersecting the corridor buffer. The TPI scores geographies on 9 demographic/socioeconomic factors, normalizes within the study corridor using quintiles, and renders a choropleth map with interactive tooltips. Users can adjust factor weights via sliders and export scored geographies for use in ArcGIS Pro.

**9 scoring factors:**
- Population density (ACS B01003)
- Employment density (LODES WAC)
- Zero-vehicle household % (ACS B08201/B11001)
- Poverty rate % (ACS B17001/B01003)
- Senior population 65+ % (ACS B01001 age bands)
- Disability % (ACS B18101)
- People of color % (ACS B03002)
- Youth population <18 % (ACS B01001 age bands)
- Limited English proficiency % (ACS C16001)

**Scoring engine** (`js/projects/tpi-scoring.js`):
- Batch ACS fetch with automatic chunking (49-variable Census API limit handled transparently)
- LODES block-level data aggregated to tract or block group level
- Corridor-only quintile normalization (scores 1–5 ranked within study area, not nationally)
- Small-N fallback: equal-interval breaks when fewer than 5 geographies
- Automatic weight redistribution when LODES data is absent
- `TPI.rescoreFromRaw()` enables instant re-scoring from cached data without new API calls

**Map visualization:**
- ColorBrewer Blues choropleth (5-class sequential, lightest = score 1, darkest = score 5)
- Choropleth inserted below buffer layers so buffers remain visible
- Hover tooltips showing GEOID, composite TPI score, and per-factor quintile breakdown
- TPI Legend sidebar panel with color swatches

**Weight sliders:**
- 9 range sliders (0–100, step 5) with real-time sum display
- Compute button disabled when weights do not sum to 100%
- Instant re-score (~300ms debounce) when sliders change and a prior result exists — zero API calls
- Reset to defaults button

**Export:**
- GeoJSON export: full FeatureCollection with GEOID, tpiScore, tpiClass, and 9×raw/score columns
- CSV export: same columns in tabular format
- Files named `tpi-export-YYYY-MM-DD.{geojson,csv}`

**Other features:**
- Stale detection: yellow warning banner when features change after a TPI computation
- Clear Map button removes choropleth and resets results
- Results summary card showing per-factor scores, composite average, max score, and geography count

**Files created:**
- `js/projects/tpi-scoring.js` — Scoring engine (factors, batch fetch, normalization, composite)
- `js/projects/transit-propensity.js` — Project registration, UI wiring, choropleth, exports
- `projects/transit-propensity.html` — Main sidebar panel HTML
- `projects/tpi-weights.html` — Weight sliders sub-panel HTML
- `projects/tpi-legend.html` — Legend sub-panel HTML

**Files modified:**
- `css/style.css` — TPI-specific styles (status indicators, results cards, sliders, legend, export buttons)
- `index.html` — Swapped FTA project for TPI (FTA commented out, not deleted)

---

## 2026-02-19

### Route-following lines with street-snapped preview

Added a new Route drawing mode that places waypoints and resolves the path between them against the real street network using the OSRM public routing API (driving profile, no API key required). Routes behave like lines in every way — buffer, feature panel, session cache, vertex editing — but their geometry follows actual streets instead of straight segments.

**How it works:**
- Click the **Route** button in the toolbar (was already a placeholder)
- Click to place waypoints; after the second, OSRM is called and the route snaps to streets
- Click the last waypoint again to save; route appears as a teal solid line
- A dashed teal preview line shows while drawing — straight immediately, street-snapped after the mouse is still for ~1 second (throttled, max 1 OSRM call/sec)
- **Delete Last** removes the most recent waypoint (or the last saved route if not drawing)
- Click a saved route to enter vertex edit mode; orange handles appear on **waypoints only** (not every street coordinate); dragging a waypoint re-routes via OSRM on release

**Buffer:**
- Routes have their own **Routes** buffer radius input (default 0.5 mi) in the Features panel, separate from Lines
- Route buffers fold into the dissolved union used by ACS/LODES summaries

**Session persistence:**
- Routes (geometry + waypoints) are saved in the session cache and restored on page load — no re-routing needed
- Import/Export includes routes

**Files modified/created:**
- `js/core/routes.js` (new) — IIFE module following the `lines.js` pattern; OSRM fetch, waypoint management, throttled preview, buffers, layers, vertex editing support
- `index.html` — `<script>` tag for `routes.js`, Routes buffer radius input in Features panel
- `js/app.js` — `renderRouteLayers()` on load, click/mousemove/undo/clear dispatch, routeBufferRadius wiring, buffer union override updated to include routes, `buildCore()` updated
- `js/core/features.js` — `fp-routes` list populated
- `js/core/editing.js` — route case in vertex edit/drag/enter/exit; waypoint-only handles; async re-route on drag release
- `js/core/cache.js` — `routes` array and `routeBufferRadius` in save/restore/reset/validate

---

## 2026-02-18

### Multi-Select Census Variables with Results Popup

Redesigned the Buffer-Area Data panel so users can select multiple census variables at once instead of one at a time. Results appear in a popup modal table.

**What changed:**
- Replaced the single-select dropdown (`<select id="varSelect">`) with a checkbox list (`<fieldset id="varSelect">`) organized into four groups: Land Use, Employment, Mobility, and Non-additive Medians
- Added "Select all" and "Clear all" links above the checkbox list
- Added `label` and `category` fields to every entry in `VAR_META` (in `js/core/utils.js`)
- Added `getSelectedVars()` helper to read checked checkboxes
- Rewrote `runSummary()` in `js/app.js` to loop over all selected variables, fetch TIGERweb geometries once (shared), then fetch ACS data per-variable
- Added a results popup modal (`#results-modal` in `index.html`) with a 4-column table: Census Category, Variable, Result, Aggregation Method
- Replaced the sidebar results card with a status area showing intersecting geography count and a "View Results Table" button that re-opens the modal
- Modal closes on X button, backdrop click, or Escape key

**Files modified:** `js/core/utils.js`, `js/app.js`, `index.html`, `css/style.css`, `css/sidebar-v2.css`

---

### 6 UI & Interaction Improvements

Six improvements to map interaction, drawing tools, feature editing, and the basemap system.

#### 1. Default buffer size = 0.5 miles
- Station buffer default changed from 0 to 0.5 miles (`js/core/stations.js`)
- Line buffer default changed from 0 to 0.5 miles (`js/core/lines.js`)
- HTML inputs updated to `value="0.5"` (`index.html`)
- Buffers now appear immediately when features are placed

#### 2. Default grab cursor
- Map cursor is now a grab hand by default (`js/core/map.js`)
- Changes to grabbing while panning, with guards for draw mode and editing state

#### 3. Draw mode crosshair cursor
- Cursor switches to crosshair when any draw tool (Station, Line, Polygon) is active (`js/app.js`)
- Reverts to grab when draw mode is toggled off

#### 4. Rubber-band preview lines
- During Line drawing, a dashed preview line extends from the last placed waypoint to the cursor
- During Polygon drawing, the same preview line extends to the cursor and closes back to the first vertex
- Implemented via `previewCoord` variable and `setLinePreview()`/`setPolygonPreview()` in `js/core/lines.js` and `js/core/polygons.js`
- Only updates the single drawing source per mousemove (lightweight)

#### 5. Basemap switcher
- Added basemap registry with 4 options: Carto Light (default), Carto Dark, OpenStreetMap, Satellite
- `switchBasemap(id)` swaps the raster tile source while preserving all data layers above it
- Custom `BasemapControl` class (MapLibre IControl) renders a layers icon button in the bottom-right corner with an upward-opening dropdown
- Active basemap is highlighted in the dropdown

**Files modified:** `js/core/map.js`, `css/style.css`

#### 6. Feature editing (station drag + vertex editing)
- **New file:** `js/core/editing.js`
- **Station drag:** Click and drag a station point to reposition it; buffers rebuild on release
- **Line/polygon vertex editing:** Click a line or polygon (when no draw mode is active) to show orange vertex handles; drag handles to reshape the feature
- Cursor changes contextually: `move` over stations, `pointer` over lines/polygons, `grabbing` during drags
- Click on empty area to exit vertex editing mode
- Feature index matching uses property values (`stationIdx`, `lineIdx`, `polyIdx`) instead of array indices for safety after deletions
- Added `moveStation()` to `js/core/stations.js`, `updateLineVertex()` to `js/core/lines.js`, `updatePolygonVertex()` to `js/core/polygons.js`
- Added `<script src="js/core/editing.js">` to `index.html` (between `polygons.js` and `features.js`)

---

### Local Cache with Reset

Session state is now automatically saved to `localStorage` and restored when the page loads. A "Reset Session" button in the toolbar clears all features, settings, and cached data to return the app to a fresh state.

**What changed:**
- New `js/core/cache.js` module exposing `App.cache` with `save()`, `restore()`, and `reset()`
- State saved: stations, lines, polygons, buffer radii, checked variables, geography level, year. LODES data is not cached (too large); only the filename is stored as a re-upload hint.
- Auto-save (debounced 500ms) is triggered after every state mutation: station/line/polygon add, remove, drag, undo, clear, buffer radius change, LODES upload, and feature rename/delete
- Restore runs once at the end of map load, after all DOM and event listeners are ready; shows "Session restored" in the status bar
- "Reset Session" button added to the toolbar, styled in danger red
- `App.notifyProject` exposed on the App namespace so external modules can trigger project updates
- Two `App.cache.save()` calls added to `js/core/editing.js` after station drag and vertex drag operations complete

**Files modified/created:** `js/core/cache.js` (new), `js/app.js`, `js/core/editing.js`, `index.html`, `css/style.css`

---

### JSON Import/Export with Anchored Buttons

The Import and Export buttons in the Features panel are now functional. Export downloads the full session as a timestamped `.json` file. Import loads a `.json` file and replaces the current session (with a confirmation dialog if features exist). The buttons are anchored to the bottom of the panel and remain visible when the feature list scrolls.

**What changed:**
- `App.cache.exportToFile()`: serializes current state and triggers a browser download named `analysis-YYYY-MM-DD.json`
- `App.cache.importFromFile(file)`: reads a JSON file via FileReader, validates schema version and structure, shows a confirmation dialog if features currently exist, applies the state, and persists to localStorage
- `applyState(state)`: extracted from `restore()` as a shared private function used by both cache restore and file import, eliminating duplication
- `validateState(state)`: validates imported JSON before applying (checks object type, schema version, array types)
- Import button triggers a hidden `<input type="file" accept=".json">` picker programmatically; Export uses Blob + object URL download
- Feature panel restructured: all content sections wrapped in `<div class="fp-content">` (scrollable), `.fp-actions` is now a flex-column footer (always visible at the bottom)
- Both buttons enabled; previously `disabled`
- Export file format is identical to the localStorage cache schema (`version: 1`)

**Files modified:** `js/core/cache.js`, `js/app.js`, `index.html`, `css/style.css`

---

## 2026-02-14

### Sidebar rebuild (Phases 1-6)
- Rebuilt the sidebar using a panel manager system (`js/core/sidebar.js`, `css/sidebar-v2.css`)
- Panels are collapsible with headers, registered via `App.sidebar.addPanel()`, and rendered once on map load
- Migrated Station-area Data, LODES, and project panels to the new system
- Narrowed sidebar from 520px to 310px
- Extracted FTA project sub-panels (CRE, ESS, LBAR) into separate collapsible panels

### Line buffer support
- Lines now have their own configurable buffer radius (separate from stations)
- Dissolved union includes both station and line buffers via override of `bufferUnionPolygon()`
- Added dedicated "Buffers" section in the Feature Panel with separate radius inputs

### Per-feature deletion
- Added trash icon delete buttons to each station, line, and polygon in the Features panel
- `removeStation()`, `removeLine()`, `removePolygon()` exposed on App namespace

### Station/buffer separation
- Separated station placement from buffer drawing; stations are always visible even with buffer radius = 0
- Removed Study Area heading, status card, and line-drawing feedback from the old sidebar

### Page title
- Changed page title to "Casey's Analysis Tool"
