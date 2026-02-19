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

### Route-following lines — Medium Priority
Like line drawing, but snapped to the underlying street network. Requires a routing engine (e.g., OSRM, Valhalla, or a hosted API). The resulting route geometry gets buffered like any other line.

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

### More census categories — Priority To Be Determined
Expand `VAR_META` in utils.js with additional ACS variables (e.g., vehicle ownership, commute mode, housing tenure, age distribution). Each entry needs a variable code, label, category, aggregation mode, and format.

### FTA Small Starts as button-triggered popup analysis — Not started
Currently the FTA Small Starts breakpoint ratings recalculate automatically on every data change (station added/removed, summary run, file upload). The intent is to move this analysis out of the persistent sidebar and into an on-demand popup triggered by a toolbar or sidebar button.

**Motivation:** Separates data entry from analysis output. The sidebar panels (Station-area Data, LODES, CRE, ESS, LBAR) become pure data inputs. FTA Small Starts — and any future analyses — become on-demand outputs that users run explicitly, similar to how "Update Summary" works for the ACS/LODES summary card.

**Behavior change:** The project `update()` hook would no longer fire automatically. Recalculation runs when the user opens the popup or clicks a Recalculate button inside it.

**Precedent:** Establishes a pattern for multiple analysis types. Future frameworks (different scoring systems, custom threshold reports, etc.) can be added as additional buttons/popups without expanding the sidebar. Small Starts is the first of what may become a menu of analyses.

**Implementation notes:** Requires a modal or panel overlay component, a trigger button (toolbar or top of sidebar), and decoupling the FTA `update()` call from the core `notifyProject()` event chain. The results modal component (`#results-modal`) now exists and could serve as a pattern.

### Simplified LBAR Housing Inventory workflow — Not started
The current LBAR workflow requires uploading a pre-formatted inventory file with lat/lon/units/county columns. A simpler flow might allow uploading a basic address list, geocoding it, and auto-detecting the county FIPS. Requires conceptual planning — the geocoding step is the main complexity (no backend, so would need a client-side or free API solution).

### Clear census overlay on data change — Implemented
Census tract/block group overlays shown after running "Update summary" disappear when the user clicks Clear or adjusts a buffer radius or draws/edits features that change the buffer union. `clearCensusOverlay()` in `census.js` sets the `census-geos` source to an empty FeatureCollection (no-op if the overlay has never been rendered). Called from `rebuildBuffers()` in stations.js, `rebuildLineBuffers()` / `clearLines()` / `undoLastLine()` in lines.js, and the Clear and Reset Session handlers in app.js.

### Additional Census Years - Medium Priority
Investigate possibility of including more recent ACS data

### Mixed-geography analysis - Medium Priority
Allow the tool to simultanesly analyze variables that are only available at different geographies (eg, Census Tract vs Block Group) with proper documentation

---

## Persistence & Export

### Local cache with reset — Implemented
Session state (stations, lines, polygons, buffer radii, variable checkbox selections, geography level, year) is auto-saved to `localStorage` after every mutation (debounced 500ms) and restored automatically on page load. LODES data is not cached (too large to serialize); only the filename is stored as a re-upload hint.

A "Reset Session" button in the toolbar clears all features and form settings, deletes the localStorage cache, and returns the app to factory defaults. Implemented in `js/core/cache.js` via `App.cache.save()`, `App.cache.restore()`, and `App.cache.reset()`.

### Export/import session data — Implemented
Export downloads the full session as `analysis-YYYY-MM-DD.json`. Import loads a `.json` file and replaces the current session (with a confirmation dialog if features exist). File format is identical to the localStorage cache schema (`version: 1`), so exported files and cached sessions are interchangeable. Implemented via `App.cache.exportToFile()` and `App.cache.importFromFile(file)` in `js/core/cache.js`. Import/Export buttons in the Features panel (right sidebar) trigger the operations; buttons are anchored to the bottom of the panel.

### External Data Import
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
