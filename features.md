# Features

Planned features and enhancements. Items are grouped by theme, not priority. Each entry should include enough context for a future session to understand the intent and begin planning.

---

## Drawing & Geometry

### Adjustable buffer radii
Currently hardcoded to 0.5 miles. Allow the user to set buffer radius per station or globally (e.g., a slider or input field in the Stations panel).

### Line drawing with buffers
Add the ability to draw polylines on the map (e.g., a proposed transit alignment). Each line segment gets a configurable buffer. The dissolved union includes both station buffers and line buffers.

### Route-following lines
Like line drawing, but snapped to the underlying street network. Requires a routing engine (e.g., OSRM, Valhalla, or a hosted API). The resulting route geometry gets buffered like any other line.

### Polygon drawing
Allow freehand or vertex-by-vertex polygon drawing for custom study areas. Polygons participate in the same geospatial calculations (ACS aggregation, LODES employment, etc.) as station buffers.

### Walkshed polygons
Compute an isochrone/walkshed polygon from a selected point (e.g., 10-minute walk). Requires a network analysis service. The walkshed polygon could replace or supplement the circular buffer.

### Unmerge dissolved union
Currently `bufferUnionPolygon()` always dissolves overlapping buffers. Add an option to keep individual buffers separate for per-station analysis or visual comparison.

### Import geospatial data (KML/KMZ/GeoJSON)
Allow the user to upload KML, KMZ, or GeoJSON files. Imported geometries appear as map layers and can optionally be used as study area boundaries for analysis.

---

## Data & Analysis

### More census categories
Expand `VAR_META` in utils.js with additional ACS variables (e.g., vehicle ownership, commute mode, housing tenure, age distribution, poverty status). Each entry needs a variable code, label, aggregation mode, and format.

### Multiple simultaneous census summaries
Currently the results card shows one variable at a time. Allow selecting multiple variables and display a table of aggregated results. May require rethinking the results card UI.

### Simplified LBAR Housing Inventory workflow
The current LBAR workflow requires uploading a pre-formatted inventory file with lat/lon/units/county columns. A simpler flow might allow uploading a basic address list, geocoding it, and auto-detecting the county FIPS. Requires conceptual planning — the geocoding step is the main complexity (no backend, so would need a client-side or free API solution).

---

## Persistence & Export

### Local cache with reset
Save the current session state (stations, uploaded files, settings) to `localStorage` or `IndexedDB`. Restore automatically on page load. Include a "Reset" button to clear cached state and start fresh.

### Export/import session data
Export the full session (station coordinates, buffer settings, uploaded data references, project state) as a JSON file. Import the same file to restore a session. Enables sharing analysis setups between users.

---

## UI & Layout

### Resizable sidebar
Allow the user to drag the sidebar edge to resize it. Currently the sidebar is a fixed 370px width defined in CSS.

### Reorderable sidebar panels
Allow the user to drag sidebar sections (Stations, Station-area Data, project panel, LODES) into a preferred order. Could use native drag-and-drop or a lightweight sortable library.

### Dynamic panel loading/unloading
Let users show/hide individual sidebar panels (e.g., collapse LODES section if not needed, or hide the project panel). Toggle via checkboxes or a panel menu.

### Basemap switcher
Add an in-app control to switch between basemap styles (e.g., Carto light, Carto dark, OpenStreetMap, satellite). Currently hardcoded to Carto light in map.js.

### Modern UI refresh
Update the visual design — better typography, spacing, input styling, card layouts, color palette. Consider a lightweight CSS framework or design tokens. Keep it dependency-free (no React/Vue).
