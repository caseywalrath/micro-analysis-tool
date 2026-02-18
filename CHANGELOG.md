# Changelog

All notable changes to this project are documented here. Entries are grouped by session date. Most recent sessions are listed first.

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
