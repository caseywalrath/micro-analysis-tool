# Features

Planned features and enhancements. Items are grouped by theme, not priority. Each entry should include enough context for a future session to understand the intent and begin planning.

Status key: **Implemented**, **Partial**, **Not started**

---

## Drawing & Geometry

### Adjustable buffer radii — Implemented
Buffer radius is user-defined via a numeric input in the Features panel (right sidebar). Default is 0 (no buffers). Entering a value draws buffers around all stations at that radius in miles. Changing the value live-updates all buffers.

### Per-feature deletion — Implemented
Each station, line, and polygon in the Features panel has a trash icon that appears on hover. Clicking it removes that single feature from the map. `removeStation(index)`, `removeLine(index)`, and `removePolygon(index)` are exposed on the App namespace.

### Line drawing — Implemented
Polyline drawing via click-to-add-waypoints, click-last-point-to-close. Lines render as red solid lines with vertex dots. Supports undo (removes last waypoint or last saved line) and clear.

### Polygon drawing — Implemented
Vertex-by-vertex polygon drawing with snap-to-close. Polygons render as green filled regions with outlines and vertex dots. Supports undo and clear.

### Line drawing with buffers — Not started
Extend the buffer system so line segments also get configurable buffers. The dissolved union would include both station buffers and line buffers.

### Route-following lines — Not started
Like line drawing, but snapped to the underlying street network. Requires a routing engine (e.g., OSRM, Valhalla, or a hosted API). The resulting route geometry gets buffered like any other line.

### Walkshed polygons — Not started
Compute an isochrone/walkshed polygon from a selected point (e.g., 10-minute walk). Requires a network analysis service. The walkshed polygon could replace or supplement the circular buffer.

### Unmerge dissolved union — Not started
Currently `bufferUnionPolygon()` always dissolves overlapping buffers. Add an option to keep individual buffers separate for per-station analysis or visual comparison.

### Import geospatial data (KML/KMZ/GeoJSON) — Not started
Allow the user to upload KML, KMZ, or GeoJSON files. Imported geometries appear as map layers and can optionally be used as study area boundaries for analysis. Import/Export buttons exist in the Features panel but are currently disabled.

---

## Data & Analysis

### More census categories — Not started
Expand `VAR_META` in utils.js with additional ACS variables (e.g., vehicle ownership, commute mode, housing tenure, age distribution, poverty status). Each entry needs a variable code, label, aggregation mode, and format.

### Multiple simultaneous census summaries — Not started
Currently the results card shows one variable at a time. Allow selecting multiple variables and display a table of aggregated results. May require rethinking the results card UI.

### Simplified LBAR Housing Inventory workflow — Not started
The current LBAR workflow requires uploading a pre-formatted inventory file with lat/lon/units/county columns. A simpler flow might allow uploading a basic address list, geocoding it, and auto-detecting the county FIPS. Requires conceptual planning — the geocoding step is the main complexity (no backend, so would need a client-side or free API solution).

---

## Persistence & Export

### Local cache with reset — Not started
Save the current session state (stations, uploaded files, settings) to `localStorage` or `IndexedDB`. Restore automatically on page load. Include a "Reset" button to clear cached state and start fresh.

### Export/import session data — Not started
Export the full session (station coordinates, buffer settings, uploaded data references, project state) as a JSON file. Import the same file to restore a session. Enables sharing analysis setups between users.

---

## UI & Layout

### Resizable sidebar — Not started
Allow the user to drag the sidebar edge to resize it. Currently the sidebar is a fixed 520px width defined in CSS.

### Reorderable sidebar panels — Not started
Allow the user to drag sidebar sections (Station-area Data, project panel, LODES) into a preferred order. Could use native drag-and-drop or a lightweight sortable library.

### Dynamic panel loading/unloading — Not started
Let users show/hide individual sidebar panels (e.g., collapse LODES section if not needed, or hide the project panel). Toggle via checkboxes or a panel menu.

### Basemap switcher — Not started
Add an in-app control to switch between basemap styles (e.g., Carto light, Carto dark, OpenStreetMap, satellite). Currently hardcoded to Carto light in map.js.

### Modern UI refresh — Not started
Update the visual design — better typography, spacing, input styling, card layouts, color palette. Consider a lightweight CSS framework or design tokens. Keep it dependency-free (no React/Vue).
