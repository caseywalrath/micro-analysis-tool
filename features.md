# Features

Planned features and enhancements. Items are grouped by theme, not priority. Each entry should include enough context for a future session to understand the intent and begin planning.

Status key: **Implemented**, **Partial**, **Not started**

---

## Drawing & Geometry

### Adjustable buffer radii — Implemented
Buffer radius is user-defined via numeric inputs in the Features panel (right sidebar). Stations and lines have separate buffer radius controls. Default is 0.5 miles. Entering a value draws buffers around all features at that radius in miles. Changing the value live-updates all buffers. The dissolved union includes both station and line buffers.

### Per-feature deletion — Implemented
Each station, line, and polygon in the Features panel has a trash icon that appears on hover. Clicking it removes that single feature from the map. `removeStation(index)`, `removeLine(index)`, and `removePolygon(index)` are exposed on the App namespace.

### Line drawing — Implemented
Polyline drawing via click-to-add-waypoints, click-last-point-to-close. Lines render as red solid lines with vertex dots. Supports undo (removes last waypoint or last saved line) and clear.

### Line drawing with buffers — Implemented
Lines have their own configurable buffer radius (separate from stations). The dissolved union includes both station and line buffers. Buffer radius is controlled via a dedicated input in the Features panel.

### Polygon drawing — Implemented
Vertex-by-vertex polygon drawing with snap-to-close. Polygons render as green filled regions with outlines and vertex dots. Supports undo and clear.

### Polygon Analysis — Implemented
Ability to include polygons as units of analysis with area-apportioned selection similar to existing buffers.

### Rubber-band preview lines — Implemented
During Line and Polygon drawing, a dashed preview line extends from the last placed waypoint to the cursor position. For polygons, the preview also shows the closing segment back to the first vertex. Implemented via `setLinePreview()` and `setPolygonPreview()` which only update the drawing source (lightweight).

### Feature editing (station drag + vertex editing) — Implemented
When no draw mode is active, features can be modified directly on the map:
- **Stations:** Click and drag to reposition. Buffers rebuild on release.
- **Lines/Polygons:** Click to enter vertex editing mode (orange handles appear). Drag handles to reshape the feature. Click on empty area to exit.
- Cursor changes contextually: `move` over stations, `pointer` over lines/polygons, `grabbing` during drags.
- Implemented in `js/core/editing.js` with helper functions `moveStation()`, `updateLineVertex()`, `updatePolygonVertex()`.

### Route-following lines — Implemented
Waypoint-based line drawing that snaps to the street network via the OSRM public routing API (driving profile, no API key required). Routes appear as teal solid lines and behave like lines in every respect: separate buffer radius, feature panel listing, session cache, vertex editing.

- Waypoints are placed by clicking; the routed path between them is fetched from OSRM after each click
- A dashed teal preview shows while drawing — straight line immediately, street-snapped after ~1 second of no mouse movement (throttled, 1 API call/sec max)
- Click the last waypoint again to save the route
- Vertex edit mode (click a saved route) shows orange handles on **user waypoints only**, not every street coordinate; dragging a waypoint re-routes the affected segments via OSRM on release
- Routes have their own buffer radius input in the Features panel; route buffers are included in the dissolved union for ACS/LODES analysis
- Implemented in `js/core/routes.js` with integration in `app.js`, `editing.js`, `features.js`, and `cache.js`

**Potential future improvements:**
- Add a travel mode selector (walking, cycling) per route


### Midpoint Insertion — Medium Priority
Click along an existing route in vertex edit mode to insert a new waypoint between existing ones

### Walkshed polygons — Low Priority
Compute an isochrone/walkshed polygon from a selected point (e.g., 10-minute walk). Requires a network analysis service. The walkshed polygon could replace or supplement the circular buffer.

### Unmerge dissolved union — Low Priority
Currently `bufferUnionPolygon()` always dissolves overlapping buffers. Add an option to keep individual buffers separate for per-station analysis or visual comparison.

### Import geospatial data (KML/KMZ/GeoJSON) — Low priority
Allow the user to upload KML, KMZ, or GeoJSON files. Imported geometries appear as map layers and can optionally be used as study area boundaries for analysis. Import/Export buttons exist in the Features panel but are currently disabled.

---

## Data & Analysis

### Multi-select census variables with results popup — Implemented
Users can select multiple census categories simultaneously via a checkbox list in the Buffer-Area Data sidebar panel. Variables are grouped into Land Use, Employment, Mobility, and Non-additive Medians. "Update summary" runs analysis for all selected variables and displays results in a popup modal table with 4 columns: Census Category, Variable, Result, and Aggregation Method. TIGERweb geometry is fetched once and shared across all ACS variables.

### Transit Propensity Index (TPI) — Implemented
Computes a composite Transit Propensity Index for all census tracts or block groups intersecting the corridor buffer. Scores geographies on 9 demographic/socioeconomic factors using ACS and LODES data, normalizes within the study corridor using quintiles (1–5), and renders a choropleth map.

**9 factors** (default weights sum to 100%): population density (15%), employment density via LODES (15%), zero-vehicle household % (12%), poverty rate % (12%), senior 65+ % (10%), disability % (10%), people of color % (10%), youth <18 % (8%), limited English proficiency % (8%).

**Key features:**
- Batch ACS fetch handles Census API's 49-variable limit via automatic chunking (53 variables total)
- Corridor-only quintile normalization — scores are ranked within the study area, not nationally
- Automatic weight redistribution when LODES data is absent
- ColorBrewer Blues choropleth with hover tooltips showing GEOID and per-factor breakdown
- 9 weight sliders (0–100, step 5) with real-time sum validation; Compute button disabled when sum ≠ 100%
- Instant re-score from cached data (~300ms debounce) when sliders change — no new API calls
- GeoJSON and CSV export with GEOID, composite score, class label, and all 9 factor raw/score columns
- Clear Map button removes choropleth and resets results
- Stale detection marks results outdated when features change

**Files:** `js/projects/tpi-scoring.js`, `js/projects/transit-propensity.js`, `projects/transit-propensity.html`, `projects/tpi-weights.html`, `projects/tpi-legend.html`

**Potential future enhancements:**
- User-uploaded facility points (schools, health centers, transit stops) for proximity scoring
- GTFS integration for existing transit service overlay
- Custom factor upload for local datasets not available via Census APIs
- Save/load weight configurations
- Alternative normalization methods (z-scores, Jenks natural breaks)
- Integration with ArcGIS Pro via GeoJSON export (current workflow) or direct ArcGIS REST API
- Greater contrast on Index Cloropaths
- Ability to draw from multiple census geographies (Block Groups + Tracts, where some data is only availabler at the tract level)
- User-editable index entries for local land use factors
- Ability to filter cloropaths (top/bottom 50% and top/bottom 10%)
- Show missing data in "Scoring Summary" column
- Methodology/inputs for manual land use scoring
- Manual placement of destinations by type on map (possibly similar to Stations)

### Transit Costing module
Produce estimates for service and revenue miles, hours, potential blocking scenarioss, pullout requirements, and staffing

### More census categories — Priority To Be Determined
Expand `VAR_META` in utils.js with additional ACS variables (e.g., vehicle ownership, commute mode, housing tenure, age distribution). Each entry needs a variable code, label, category, aggregation mode, and format.

### Analysis module popup system — Implemented
Analysis modules now launch from buttons in a single "Analysis" sidebar panel and open in popup windows. This replaced the old one-project-at-a-time sidebar panel system. Multiple modules register simultaneously via `App.registerModule()`. The popup system (`js/core/popup.js`) handles HTML loading, init/open/close lifecycle, Escape key priority, and floating map widgets. TPI is the first module migrated; FTA Small Starts is registered but disabled.

### FTA Small Starts popup UI — Partial
FTA Small Starts is registered as a disabled module (button shown grayed out in the Analysis panel). The popup infrastructure exists (`App.popup`, module registry), but the FTA popup HTML and popup-specific wiring have not been built yet. The original sidebar-based code (`fta-small-starts.js`) is still intact and will need to be adapted to the popup layout pattern (similar to how TPI was migrated).

### Simplified LBAR Housing Inventory workflow — Not started
The current LBAR workflow requires uploading a pre-formatted inventory file with lat/lon/units/county columns. A simpler flow might allow uploading a basic address list, geocoding it, and auto-detecting the county FIPS. Requires conceptual planning — the geocoding step is the main complexity (no backend, so would need a client-side or free API solution).

### Clear census overlay on data change — Implemented
Census tract/block group overlays shown after running "Update summary" disappear when the user clicks Clear or adjusts a buffer radius or draws/edits features that change the buffer union. `clearCensusOverlay()` in `census.js` sets the `census-geos` source to an empty FeatureCollection (no-op if the overlay has never been rendered). Called from `rebuildBuffers()` in stations.js, `rebuildLineBuffers()` / `clearLines()` / `undoLastLine()` in lines.js, and the Clear and Reset Session handlers in app.js.

### Additional Census Years - Implemented
Investigate possibility of including more recent ACS data

### Mixed-geography analysis - Implemented
Allow the tool to simultanesly analyze variables that are only available at different geographies (eg, Census Tract vs Block Group) with proper documentation

### Title VI Analysis Module — Not started
A new analysis module for Title VI civil rights compliance reporting. Title VI of the Civil Rights Act of 1964 requires that federally funded transit projects do not disproportionately burden minority and low-income populations. This module would leverage existing TPI/ACS infrastructure to automate the demographic analysis portion of a Title VI equity assessment. See document Title_VI_Module_Overview.md

**Core concept:** Compare demographic composition inside the project corridor (buffer union) against a reference area (county, metro area, or user-defined region) to identify whether protected populations are disproportionately affected.

**Key populations to analyze:**
- Minority (non-white) population share
- Low-income households (below poverty threshold)
- Limited English Proficiency (LEP) households
- Senior (65+) population
- Zero-vehicle households
- People with disabilities

**Potential features:**
- Side-by-side comparison table: corridor demographics vs. reference area demographics
- Disparate impact flagging when corridor shares exceed reference area thresholds (e.g., corridor minority % > reference minority %)
- Multiple reference area options: county-level (auto-detected from corridor location), MSA-level, or custom polygon
- Map overlay showing Title VI population concentrations within the corridor
- Exportable summary suitable for inclusion in Title VI reports (CSV/PDF)
- Integration with existing ACS fetch infrastructure — most required variables are already in VAR_META or TPI factors
- FTA reporting format alignment where applicable

**Dependencies:** Builds on `census.js` (ACS fetch + aggregation), `tpi-scoring.js` (factor definitions, batch ACS), and the popup module system (`App.registerModule`). Would register as a new popup-based module in the Analysis panel.

**Files (anticipated):** `js/projects/title-vi.js`, `projects/title-vi-popup.html`

---

## Persistence & Export

### Local cache with reset — Implemented
Session state (stations, lines, polygons, buffer radii, variable checkbox selections, geography level, year) is auto-saved to `localStorage` after every mutation (debounced 500ms) and restored automatically on page load. LODES data is not cached (too large to serialize); only the filename is stored as a re-upload hint.

A "Reset Session" button in the toolbar clears all features and form settings, deletes the localStorage cache, and returns the app to factory defaults. Implemented in `js/core/cache.js` via `App.cache.save()`, `App.cache.restore()`, and `App.cache.reset()`.

### Export/import session data — Implemented
Export downloads the full session as `analysis-YYYY-MM-DD.json`. Import loads a `.json` file and replaces the current session (with a confirmation dialog if features exist). File format is identical to the localStorage cache schema (`version: 1`), so exported files and cached sessions are interchangeable. Implemented via `App.cache.exportToFile()` and `App.cache.importFromFile(file)` in `js/core/cache.js`. Import/Export buttons in the Features panel (right sidebar) trigger the operations; buttons are anchored to the bottom of the panel.

### External Data Import - Low Priority
Investigate possibility of importing external data such as .KML Files



---

## UI & Layout

### Basemap switcher — Implemented
Bottom-right map control with a layers icon button. Click to open an upward dropdown with 4 basemap options: Carto Light (default), Carto Dark, OpenStreetMap, and Satellite. Active basemap is highlighted. Switching preserves all data layers. Implemented as a custom `BasemapControl` class (MapLibre IControl) in `js/core/map.js`.

### Cursor management — Implemented
- Default map cursor is a grab hand; changes to grabbing while panning
- Draw mode (Station, Line, Polygon) switches cursor to crosshair
- Cursor reverts to grab when draw mode is deactivated
- Hover cursors show `move` over stations, `pointer` over lines/polygons during idle
- Cursor state machine guards prevent conflicts between draw mode and editing

### UI Cleanup — Implemented
Removed the methodology note from the Buffer-Area Data sidebar panel. The note ("Summaries are computed within the dissolved union of all buffers. Set the buffer radius in the Features panel. For ACS, counts are area-apportioned and medians are shown as an area-weighted average estimate.") now appears as small muted text at the bottom of the Buffer-Area Summary Results popup modal, where it is more contextually relevant.

### Resizable sidebar — Low Priority
Allow the user to drag the sidebar edge to resize it. Currently the sidebar is a fixed 310px width defined in `css/sidebar-v2.css`.

### Reorderable sidebar panels — Low Priority
Allow the user to drag sidebar sections (Buffer-Area Data, project panel, LODES) into a preferred order. Could use native drag-and-drop or a lightweight sortable library.

### Dynamic panel loading/unloading — Low Priority
Let users show/hide individual sidebar panels (e.g., collapse LODES section if not needed, or hide the project panel). Toggle via checkboxes or a panel menu.

### Modern UI refresh — Low Priority
Update the visual design — better typography, spacing, input styling, card layouts, color palette. Consider a lightweight CSS framework or design tokens. Keep it dependency-free (no React/Vue).
