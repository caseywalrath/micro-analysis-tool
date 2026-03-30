# Features

Planned features and enhancements. Items are grouped by theme, not priority. Each entry should include enough context for a future session to understand the intent and begin planning.

Status key: **Implemented**, **Partial**, **Not started**

---

## Drawing & Geometry


**Potential future improvements:**
- Add a travel mode selector (walking, cycling) per route


### Midpoint Insertion — Medium Priority
Click along an existing route in vertex edit mode to insert a new waypoint between existing ones

### Walkshed polygons — Low Priority
Compute an isochrone/walkshed polygon from a selected point (e.g., 10-minute walk). Requires a network analysis service. The walkshed polygon could replace or supplement the circular buffer.

### Unmerge dissolved union — Low Priority
Currently `bufferUnionPolygon()` always dissolves overlapping buffers. Add an option to keep individual buffers separate for per-station analysis or visual comparison.

### Import geospatial data (KML/KMZ/GeoJSON) — PARTIALLY IMPLEMENTED
Allow the user to upload KML, KMZ, or GeoJSON files. Imported geometries appear as map layers and can optionally be used as study area boundaries for analysis. 

---

## Data & Analysis


**Potential future TPI enhancements:**
- User-uploaded facility points (schools, health centers, transit stops) for proximity scoring
- GTFS integration for existing transit service overlay
- Custom factor upload for local datasets not available via Census APIs
- Alternative normalization methods (z-scores, Jenks natural breaks)
- Integration with ArcGIS Pro via GeoJSON export (current workflow) or direct ArcGIS REST API
- User-editable index entries for local land use factors
- Ability to filter cloropaths (top/bottom 50% and top/bottom 10%)
- Show missing data in "Scoring Summary" column
- Methodology/inputs for manual land use scoring
- Manual placement of destinations by type on map (possibly similar to Stations)

### Transit Costing module
Produce estimates for service and revenue miles, hours, potential blocking scenarioss, pullout requirements, and staffing

### More census categories — Priority To Be Determined
Expand `VAR_META` in utils.js with additional ACS variables (e.g., vehicle ownership, commute mode, housing tenure, age distribution). Each entry needs a variable code, label, category, aggregation mode, and format.


### FTA Small Starts popup UI — Partial
FTA Small Starts is registered as a disabled module (button shown grayed out in the Analysis panel). The popup infrastructure exists (`App.popup`, module registry), but the FTA popup HTML and popup-specific wiring have not been built yet. The original sidebar-based code (`fta-small-starts.js`) is still intact and will need to be adapted to the popup layout pattern (similar to how TPI was migrated).

### Simplified LBAR Housing Inventory workflow — Not started
The current LBAR workflow requires uploading a pre-formatted inventory file with lat/lon/units/county columns. A simpler flow might allow uploading a basic address list, geocoding it, and auto-detecting the county FIPS. Requires conceptual planning — the geocoding step is the main complexity (no backend, so would need a client-side or free API solution).



### Title VI Analysis Module — Partially Implemented
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


### External Data Import - Partially Implemented
Investigate possibility of importing external data such as .KML Files



---

## UI & Layout

### UI Cleanup — Implemented
Removed the methodology note from the Buffer-Area Data sidebar panel. The note ("Summaries are computed within the dissolved union of all buffers. Set the buffer radius in the Features panel. For ACS, counts are area-apportioned and medians are shown as an area-weighted average estimate.") now appears as small muted text at the bottom of the Buffer-Area Summary Results popup odal, where it is more contextually relevant.

### Reorderable sidebar panels — Low Priority
Allow the user to drag sidebar sections (Buffer-Area Data, project panel, LODES) into a preferred order. Could use native drag-and-drop or a lightweight sortable library.

### Dynamic panel loading/unloading — Low Priority
Let users show/hide individual sidebar panels (e.g., collapse LODES section if not needed, or hide the project panel). Toggle via checkboxes or a panel menu.

### Modern UI refresh — Low Priority
Update the visual design — better typography, spacing, input styling, card layouts, color palette. Consider a lightweight CSS framework or design tokens. Keep it dependency-free (no React/Vue).
