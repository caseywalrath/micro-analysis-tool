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

### Import geospatial data (KML/KMZ/GeoJSON) — Partial
Allow the user to upload KML, KMZ, or GeoJSON files. Imported geometries appear as map layers and can optionally be used as study area boundaries for analysis. Import/Export buttons exist in the Features panel but are currently disabled.

### Floating attributes popup — Implemented
Feature attributes (name, direction, mode, frequency, span, stop ID, notes, etc.) now open in a floating draggable popup (`#fp-attr-popup`) rather than an inline slide-down panel. The popup is 320px wide, position: fixed, clamped within viewport on drag and resize, closes on Escape or X button, and auto-updates when the user selects a different feature. Opened via the gear icon (⚙) that appears on each feature row on hover, or via right-click → "Attributes". Row click now selects only; the trash icon stays in the row with its inline confirm strip.

### Concentric buffer rings — Not started
Draw multiple concentric rings at user-defined distances (e.g. 0.25/0.5/1 mi) around a point or line, distinct from the current single-radius buffer. Useful for graduated service-area visualizations and walking-distance comparisons.

### Freehand drawing mode — Not started
Draw lines and polygons by holding and dragging rather than click-by-click vertex placement. Useful for sketching irregular study areas or approximate corridors quickly.

### Copy / paste features — Not started
Duplicate a drawn feature in place (Ctrl+D shortcut or context menu item). Creates an independent copy with a new name. Useful for quickly creating "before/after" scenario variants.

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


### Title VI Analysis Module —Partial
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

### GTFS import — Implemented
Upload a GTFS `.zip` via Add Data (+) → GTFS → Load GTFS Feed. Routes (shapes.txt) render as dashed gray reference lines and stops (stops.txt) as hollow circles below user-drawn features. Hovering shows a tooltip (route name + mode, or stop name + ID); clicking shows a full detail popup with route color swatch, GTFS fields, and wheelchair/location-type labels. Route info is pre-joined from trips.txt + routes.txt at load time. The analysis popup shows all files in the ZIP with REQ/OPT badges and a scrollable CSV table viewer (capped at 500 rows). Layer visibility toggles in the popup. Feed is not persisted across sessions (re-upload required).

**Potential future enhancements:**
- Derive frequency/headway from stop_times.txt for an automatic frequency heatmap overlay
- Filter displayed routes by route_type or agency
- Persist GTFS feed across sessions (localStorage is too small; IndexedDB or a re-upload prompt would be needed)

### FTA STOPS-Style Ridership Modeling — Not started
A new analysis module that replicates or approximates the methodology of FTA's STOPS (Simplified Trips-on-Project Software) model. STOPS is FTA's official ridership forecasting tool for Small Starts and some New Starts projects. It estimates **station-level boardings** by modeling three things: where people want to go (destination attractiveness), how well transit gets them there (accessibility via travel time), and how likely they are to choose transit over driving (mode share).

**What the app already covers (demand/demographic side):**
- Population and employment density scoring (TPI's 9-factor system, ACS + LODES)
- Station placement with configurable walk-access buffers
- GTFS feed parsing (shapes, stops, stop_times, routes, trips all available in-browser)
- Corridor Demand Index (CDI) — population-weighted composite demand score per route
- Area-weighted census aggregation within buffer polygons
- Ridership calibration workflow (ratio and OLS regression against observed data)

**What's missing (accessibility/supply side):**
1. **Transit travel time engine** — Parsing GTFS `stop_times.txt` to compute actual A-to-B transit trip durations including transfers, wait times, and walk access. The GTFS module currently displays feed data but does not route through it. Implementing a RAPTOR or Connection Scan algorithm in JS is feasible but computationally intensive for large feeds.
2. **Auto travel time matrix** — Zone-to-zone driving times for mode choice comparison. The app already uses OSRM for route snapping, but building a full matrix for hundreds of zones would require many API calls.
3. **Origin-destination trip table** — STOPS uses a simplified O-D matrix derived from census journey-to-work data (CTPP or ACS commuting flows). The app has employment via LODES but not the O-D flow structure.
4. **Mode choice model** — A logit function estimating probability of choosing transit vs. auto based on relative travel time, cost, and traveler characteristics. The math is straightforward; calibration data is the constraint.
5. **Station-level boarding allocation** — Distributing corridor-level demand across individual stations based on walk catchment area and destination accessibility.

**Architectural options:**
- **Pure in-browser:** Consistent with the app's zero-build-step philosophy. Demand-side and mode choice math are lightweight. The bottleneck is transit travel time computation from raw GTFS — JS implementations of RAPTOR exist but may struggle with large feeds (thousands of trips). Auto travel time matrices would require heavy OSRM usage.
- **Local helper tool:** A Python or Node CLI that runs OTP or OSRM locally to precompute travel time matrices, exporting results as JSON for the web app to import. Breaks the "just open index.html" simplicity but handles the computationally intensive piece.
- **Hybrid (recommended):** The web app handles UI, demographics, scoring, mode choice, and boarding allocation. A lightweight local helper precomputes the travel time matrix from the GTFS feed + road network and exports a JSON file that the web app imports as a data input (similar to how LODES CSVs are uploaded today). Keeps interactive analysis in-browser while offloading the one piece that genuinely needs more horsepower.

**Dependencies:** Builds on `census.js` (ACS fetch), `lodes.js` (employment), `tpi-scoring.js` (demand scoring), `gtfs.js` (feed parsing), `stations.js` (station placement + buffers), and the popup module system. The travel time matrix — whether computed in-browser or imported — is the critical new data input.

**Files (anticipated):** `js/projects/fta-stops.js`, `projects/fta-stops-popup.html`, and potentially a standalone helper script (Python or Node) for travel time matrix generation.

### CSV point import — Not started
Upload a CSV with lat/lon columns (auto-detected via `App.guessHeader`) and plot as a styled point layer. Common uses: existing stop-level boardings, peer-system data, community facility inventories. Pairs with the future Layer Panel for visibility control.


### Frequency / service heatmap — Not started
Color route segments by headway or span drawn directly from the route attributes already stored per feature (frequency field in minutes, spanStart/spanEnd). Visual equivalent of a GTFS-based frequency map for proposed service. Could use a diverging color ramp (green = frequent, red = infrequent).

### Transfer connectivity scoring — Not started
Given multiple drawn routes, identify overlap zones and score transfer quality based on shared stop proximity and frequency pairing. Output: a map overlay flagging strong/weak transfer nodes and a summary table.

### Stop spacing analyzer — Not started
Flag segments of a drawn route where stop spacing is too tight (below a minimum threshold) or too wide (above a maximum) vs. a user-configurable target distance. Highlights problematic segments on the map in a distinct color.

### Multi-variable equity index builder — Not started
Extend TPI to a fully user-composable index: select any 3–5 ACS variables from the existing `VAR_META` catalog, assign weights, and output a scored choropleth. Removes the constraint of TPI's fixed 9 factors while reusing all existing ACS fetch and quintile normalization infrastructure.

### Demographic change over time — Not started
Compare ACS 5-year estimates across two user-selected years for the study corridor. Output a map and table flagging areas with the largest demographic shifts. Useful for long-range planning and Title VI cumulative-impact analysis.

### Environmental Justice overlay — Not started
Pull EPA EJScreen percentile data for the study area as a reference choropleth layer. Covers climate risk, air quality, and traditional EJ indicators. Standard contextual layer for FTA, RAISE, and INFRA grant applications. EJScreen has a public REST API.

### Census geography profile cards — Not started
Click any census tract or block group on a choropleth overlay to get a floating card with key demographics (population, minority share, median income, zero-vehicle HH %, etc.). Currently hovering shows only the GEOID and TPI score; a full profile card would improve interpretability.

---

## Persistence & Export


### External Data Import - Partial
Investigate possibility of importing external data such as .KML Files

### Read-only share link — Not started
Encode the full session state as a compressed URL hash (using LZ-string or similar client-side compression) so sharing a link opens the map in view-only mode with all drawn features and last analysis settings intact. No backend required. Fits the existing JSON session schema; the hash would be a compressed version of the same export format.

### Map export (PNG / PDF) — Not started
Export the current map view as a PNG screenshot (using MapLibre's `map.getCanvas().toBlob()`) or a simple one-page PDF with a legend and key summary stats from the last analysis run. Agencies use this constantly for board presentations and grant documentation. A lightweight PDF library (jsPDF) could handle layout without a backend.

### Session comments / sticky notes — Not started
Pin a text annotation to a specific map location. Notes persist in the session cache alongside drawn features. Useful for sharing a session with stakeholders who need to mark feedback or flag questions on the map.

---

## UI & Layout

### Resizable sidebar — Low Priority
Allow the user to drag the sidebar edge to resize it. Currently the sidebar is a fixed 310px width defined in `css/sidebar-v2.css`.

### Reorderable sidebar panels — Low Priority
Allow the user to drag sidebar sections (Buffer-Area Data, project panel, LODES) into a preferred order. Could use native drag-and-drop or a lightweight sortable library.

### Dynamic panel loading/unloading — Low Priority
Let users show/hide individual sidebar panels (e.g., collapse LODES section if not needed, or hide the project panel). Toggle via checkboxes or a panel menu.

### Modern UI refresh — Low Priority
Update the visual design — better typography, spacing, input styling, card layouts, color palette. Consider a lightweight CSS framework or design tokens. Keep it dependency-free (no React/Vue).

### Floating vertical icon rail (toolbar redesign) — Not started
Move draw tools out of the horizontal top bar and into a compact vertical icon strip on the left edge of the map (similar to Felt or Mapbox Studio). Frees the top bar for session-level actions: project name, share link, export, and reset. Reduces visual clutter and scales better as more draw tools are added.

### Command palette (Ctrl+K) — Not started
A keyboard-triggered search overlay that lets users reach any tool, analysis module, or action by typing. Increasingly standard in modern web tools (Figma, Linear, Notion, Arc). Especially valuable as the feature set grows. Could be implemented as a simple filtered list over a flat registry of labeled actions.

### Layer panel — Not started
A dedicated panel listing all drawn feature groups and imported reference layers, with per-layer visibility toggles, opacity sliders, and draw-order control (drag to reorder). Becomes essential once GTFS import and CSV import are added. Modeled on Felt's layers panel.


### Keyboard shortcuts — Not started
Standard single-key shortcuts for draw modes: `S` = Station, `L` = Line, `R` = Route, `P` = Polygon. `Escape` cancels current draw operation; `Enter` finishes a line/route. Shortcut hints shown in toolbar button tooltips on hover.

### Feature search / jump-to — Not started
A search input (in the feature panel or command palette) that filters the feature list and pans/zooms the map to the matching feature. Important in sessions with 20+ drawn routes.


### Mini map / overview inset — Not started
A small inset map in a corner (e.g. bottom-right, above the basemap switcher) showing the full project extent with a rectangle indicating the current viewport. Useful when zoomed into detail editing on a large corridor.

### Dark mode (full UI) — Not started
The basemap switcher already has a Carto Dark option; extend a dark theme to the sidebar, feature panel, toolbar, and all popups. Implement via a CSS class toggle on `<body>` with CSS custom property overrides. No new dependencies needed.

### Print / presentation mode — Not started
A "present" button that temporarily hides the sidebar, feature panel, and toolbar to show the map full-screen. Useful for screen-sharing in stakeholder meetings. Toggle back with a persistent floating button or keyboard shortcut.
