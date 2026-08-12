# Features

Planned features and enhancements. Items are grouped by theme, not priority. Each entry should include enough context for a future session to understand the intent and begin planning.

Status key: **Implemented**, **Partial**, **Not started**

---

## Drawing & Geometry

**Potential future improvements:**
- Add a travel mode selector (walking, cycling) per route


### Midpoint Insertion — Implemented
Click along an existing route/line/polygon in vertex edit mode to insert a new vertex. `insertVertex` in `js/core/editing.js` (`turf.nearestPointOnLine`), undo-supported.

### Segment split in edit mode — Not started
Split a drawn line/route into two independent features at a clicked vertex (or an arbitrary clicked point along the geometry). Vertex *deletion* already exists (`deleteVertex` / `canDeleteVertex` in `js/core/editing.js`, wired to the Delete key); this adds the complementary "cut here" operation. Reuse the same geometry helpers as midpoint insert (`turf.nearestPointOnLine` to locate the cut, `turf.lineSlice` to produce the two halves), push both new features with undo, and split attributes (each half inherits the original's `attributes`). Useful for breaking a long corridor into separately-costed patterns.

### Snap-to-layer while drawing — Not started
While drawing a line/route/polygon, snap new vertices to nearby reference geometry — GTFS shape lines (`gtfs-shapes-layer`) and OSM lines — not just the current snap-to-close behavior. Today snapping is limited to closing the shape within `SNAP_PIXELS` of the first/last waypoint (`js/core/lines.js`, `js/core/routes.js`, `js/core/polygons.js`). Reuse the existing rendered layers (already queried for hover/click) to find the nearest candidate within a pixel threshold and snap the cursor/vertex to it. Lets users trace existing service or street alignments precisely when building proposals.


### Walkshed polygons — Implemented
True street-network walking isochrones from placed Points, entirely in-browser. **Walkshed** module (`js/projects/walkshed.js`) uses `App.computeWalkshed` (`js/core/road-network.js`: budget-limited flood Dijkstra + concave-hull polygon); requires a loaded road network. Points flagged `attributes.serviceAreaType = "walkshed"` substitute the walkshed for the circular buffer in `rebuildBuffers()`, so every study-area consumer (BAS, TPI, Title VI, FTA, corridor pickers) picks it up automatically.

### Walkshed sidewalk & access refinement — Not started
A further precision pass on the walkshed network, building on the class-aware traversal already in place (`js/core/road-network.js` tags every edge/segment `pedBlocked`/`carBlocked` from the OSM `highway` class and `foot` tag, so motorways/trunk roads and their ramps are already excluded from walksheds, pedestrian ways — footway/path/steps/pedestrian/cycleway/living_street — are already included, and driving routes still ignore pedestrian-only ways).

**What this adds:** lean on OSM sidewalk and access tagging to refine *which* segments a pedestrian can actually use, rather than relying on the highway class alone.
- **Sidewalk data (two forms).** OSM encodes sidewalks either as `sidewalk=both/left/right/no/none` tags on a road centerline, or as separately-mapped `highway=footway` + `footway=sidewalk` ways. The separately-mapped form already flows into the network via the footway class; the centerline `sidewalk=*` tag is not yet captured. Capturing it would let a walkshed prefer/weight streets known to have sidewalks and down-weight or exclude `sidewalk=no` arterials.
- **Access tags.** Extend the existing `foot=*` override to also honor `access=private`, `access=no`, and `foot=private` so technically-mapped-but-un-walkable segments (gated service roads, private drives) are dropped. Cheap once the tags are captured — the classifier hook (`isPedForbidden`) is already the single choke point.
- **High-stress arterial-crossing penalty (AECOM TLOS).** Beyond a binary include/exclude, apply an edge-weight *multiplier* in `buildGraph` for segments that cross or run along high-stress arterials, so the walkshed is pruned where a pedestrian realistically won't cross (a freeway or 6-lane arterial makes a nominally-close stop unreachable). Same soft-weighting hook as the sidewalk signal; degrades gracefully to today's behavior where the classifying tags are absent.

**⚠ Caveats (why this is "nice if present, never required"):**
- **Coverage is wildly inconsistent.** Sidewalk tagging is excellent in a handful of well-mapped cities and essentially absent across most of the US. Logic that *depends* on `sidewalk=*` would make the tool behave very differently region to region — a walkshed that looks precise in Seattle and empty in a mid-size county — which is hard to explain to the beginner audience (see `CLAUDE.md`). Treat sidewalk tags as an optional refinement signal, never a hard requirement: absent tag ⇒ fall back to today's class-based behavior, don't exclude the street.
- **Directionality (`sidewalk=left/right`) is rarely worth modeling** given the network is undirected and pedestrians cross freely; collapse to a simple present/absent signal.
- **Don't silently change results.** Because coverage is spotty, any sidewalk-aware mode should be surfaced to the user (e.g. an opt-in toggle or a footnote noting how many segments carried sidewalk tags) rather than quietly reshaping the walkshed.

**Files to touch:** `js/core/road-network.js` — capture `sidewalk` (and the extra `access`/`foot` values) in the Overpass→GeoJSON conversion and in `loadRoadNetworkFromFile`'s pass-through, then extend `isPedForbidden` / add a soft-weighting hook; optionally expose the opt-in toggle + footnote in `js/projects/walkshed.js` / `projects/walkshed-popup.html`.

### Transit Travelshed Engine — Not started
The strategic centerpiece. Reuses the walkshed engine's bones and unlocks
the Cumulative-Opportunity Transit Accessibility entry above.

#### Architecture sketch (extends `road-network.js` + `walkshed.js` patterns)

**Inputs:** origin (clicked point or existing Point feature), total time
budget T (e.g. 45 min), walk speed, day type + time period (to select the
active band per route via `getEffectiveServiceBands`), boarding penalty
(default ~1–2 min), transfer cap (v1: 1).

**Algorithm — layered floods rather than a true multimodal graph:**
1. **Initial walk flood** from the origin using the existing budget-limited
   Dijkstra, but keeping per-node *arrival times* (the engine already settles
   nodes with costs; we expose them instead of only polygonizing).
2. **Boarding points:** Point features with `associatedRoutes` (real stops);
   for routes with no stop points, synthesize stops by sampling the geometry
   at the service type's `defaultStopSpacing`. Snap to network
   (`snapToNetwork` exists, walk mode).
3. **Ride:** for each boarding point reached at time t₀ < T: wait = headway/2
   (from the selected period's band) + boarding penalty, then propagate along
   the route geometry at `avgSpeed` (or proportional `runTime`) to each
   downstream stop. **The `direction` attribute governs propagation** — "Both"
   propagates both ways; Loop/CW/CCW propagates one way around. (Note how
   this makes the directionality multiplier's effect *visible* rather than
   assumed.)
   DEVELOPER NOTE: I wonder if headway/2 is the best measure for low-frequency routes where users are more likely to time their departure around the bus schedule; are we unfairly penalizing these routes here? Need further research.
5. **Egress walk floods:** from each alighting stop with remaining budget,
   run another walk flood; the travelshed is the union of all reached nodes
   across all floods. One transfer = repeat step 3 from boarding points
   newly reached by egress floods.
6. **Polygonize** with the existing concave-hull auto-relax loop; optionally
   render banded isochrones (15/30/45) by thresholding node arrival times.

**The key performance design decision:** per-stop walk floods must be
computed **once at full budget, storing per-node distances**, then *thresholded*
per query — not re-flooded per remaining-budget value. That makes a single
travelshed cost ~(stops reached) cheap floods with heavy cache reuse, and it's
what makes the batch accessibility mode (hundreds of origins) feasible at all.
Cache keyed like the walkshed module: settings + network epoch + feature geometry.

#### What we're missing / assuming
- **Real stop locations** for drawn scenarios (mitigated by `associatedRoutes`
  points where placed, sampled spacing otherwise — disclose which was used).
- **Schedules**: frequency-based wait assumption, as discussed above.
- **Dwell times, transfer reliability**: fold into the boarding penalty knob.
- **Speed realism**: `avgSpeed` is user-asserted; `runTime` where entered is
  better. Both already exist as attributes.

**Effort:** large — the biggest single lift on this list (new engine
surface in `road-network.js`, a new module, careful caching) — but it's
incremental on proven code, not greenfield, and it's the prerequisite for the
highest-value consulting outputs (the accessibility headline stats above).

### Unmerge dissolved union — Low Priority
Currently `bufferUnionPolygon()` always dissolves overlapping buffers. Add an option to keep individual buffers separate for per-station analysis or visual comparison.

### Import geospatial data (KML/KMZ/GeoJSON) — Implemented
Upload KML, KMZ, GeoJSON, JSON, CSV, or shapefile (.shp/.zip) via Add Data (+) → Spatial Data as editable features. `js/app.js` extension router → `importKML`/`importFromFile`/`importCSV`/`importSHP` in `js/core/cache.js`.

### Floating attributes popup — Implemented
Feature attributes open in a floating draggable popup (`#fp-attr-popup`, 320px, clamped to viewport, Escape/X to close, auto-updates on selection change). Opened via the row's gear icon (⚙) or right-click → "Attributes".

### Concentric buffer rings — Not started
Draw multiple concentric rings at user-defined distances (e.g. 0.25/0.5/1 mi) around a point or line, distinct from the current single-radius buffer. Useful for graduated service-area visualizations and walking-distance comparisons.

### Freehand drawing mode — Not started
Draw lines and polygons by holding and dragging rather than click-by-click vertex placement. Useful for sketching irregular study areas or approximate corridors quickly.

### Copy / paste features — Implemented
Right-click → "Duplicate" creates an independent copy of any feature type (`duplicatePoint`/`duplicateLine`/`duplicateRoute`/`duplicatePolygon`/`duplicateLabel`/`duplicateTextBox`). Remaining nice-to-have: a Ctrl+D shortcut.

### Copy Attributes (Attribute Summary) — Implemented
Per-row Copy button in the Attribute Summary popup (`js/projects/attribute-summary.js`) opens a modal to copy a source feature's attributes onto one or more compatible targets (Points/Lines/Routes/Polygons; `serviceId` excluded), with per-attribute/per-target selection, an overwrite warning, and one undo step for the whole batch.

---

## Data & Analysis

**Potential future TPI enhancements:**
- GTFS integration for existing transit service overlay
- Custom factor upload for local datasets not available via Census APIs
- Alternative normalization methods (z-scores, Jenks natural breaks)
- Integration with ArcGIS Pro via GeoJSON export (current workflow) or direct ArcGIS REST API
- User-editable index entries for local land use factors
- Ability to filter cloropaths (top/bottom 50% and top/bottom 10%)
- Show missing data in "Scoring Summary" column
- Methodology/inputs for manual land use scoring

### TPI "Important Destinations" factor — Not started

Add an optional 10th factor to the TPI scoring engine using OSM Points of Interest loaded via the Add Data tool (`App.osmPoiFeatures`). Surfaces trip attractors that ACS data cannot capture: a regional hospital in a low-density suburb, a community college, a park-and-ride terminal. The factor is opt-in (active only when POIs are loaded and enabled in TPI settings), carries a fixed default weight of 5 (not user-adjustable via the Adjust Weights modal), and is clearly flagged in TPI results and CSV exports when active.

**Scoring method — proximity-weighted sum, then quintile:**
For each block group, compute `score_i = Σ (importance_j / turf.distance(centroid_i, poi_j, "miles"))` across all loaded POIs. This produces a smooth, non-sparse distribution that correctly propagates the benefit of nearby destinations to surrounding block groups — not just the one containing the facility. Block group centroids computed via `turf.centroid()`. No new Census API calls; pure client-side geometry run after TIGERweb geographies are fetched.

**Double-counting note:** Overlap with Employment Density is real but limited to the specific case where a major employer sits in an already-dense block group. For the primary use case — an atypical destination in a low-density area — overlap is minimal and the factor adds unique signal.

**Subjectivity mitigation:** Labelled "User-Defined Destinations" in results and CSV export. The fixed 5-point weight prevents it from overriding the objective ACS/LODES factors. A footnote in the TPI results panel mirrors the existing LODES warning pattern.

**Files to modify:**
- `js/projects/tpi-scoring.js` — add 10th factor definition; read `App.osmPoiFeatures` to compute proximity scores; integrate into `TPI.computeTPI()` pipeline
- `js/projects/transit-propensity.js` — show/hide Destinations row in factor breakdowns; add footnote when active; exclude from Adjust Weights modal (fixed weight)
- `js/core/osm-pois.js` — `App.osmPoiFeatures` already exposed; no changes needed

### Transit Costing module — Partial
Delivered as **Route Costing** (`js/projects/route-costing.js`): service/revenue miles, rev/plat hours (daily + annualized), layover/deadhead, peak pullout, fleet + spares. Missing: staffing estimates; interlines fleet pooling is built but UI-disabled pending review.

### More census categories — Partial
`VAR_META` (`js/core/utils.js`) has grown to ~60 ACS/LODES variables across Demographics, Equity, Travel, Housing, and Employment. Open-ended — can keep growing.

### Ridership vs. Coverage Allocator — Not started
Jarrett Walker's hallmark budget-philosophy split: tag each drawn route/line as **"Ridership"** (frequent service on dense corridors) or **"Coverage"** (lifeline service everywhere), then report what share of total revenue hours / miles goes to each — updating live as the user draws routes or changes frequency. Add a single `purpose` enum attribute (Ridership | Coverage | unset) alongside the existing `direction`/`mode`/`serviceId` fields in `js/core/feature-attributes.js`; the Attribute Summary table and Copy Attributes pick it up like any other field. Route Costing already computes per-Service `revHrs`/`miles`/`platHrs` per day and annualized (`computeService` / `computeSystemSummary` in `js/projects/route-costing.js`), so the split is a pure group-by-`purpose` aggregation of numbers we already have — surface it as a section in the Route Costing results or a lightweight system dashboard. The split-ratio math is a pure function → golden-value test case per the testing policy.


### FTA Small Starts popup UI — Implemented
Popup module (`js/projects/fta-small-starts.js`, `projects/fta-small-starts-popup.html`), 2-tab (Ratings | Data Inputs): CRE/ESS/LBAR uploads with column mapping, five rating cards, breakpoint classification, session persistence, CSV export.

### Simplified LBAR Housing Inventory workflow — Not started
The current LBAR workflow requires uploading a pre-formatted inventory file with lat/lon/units/county columns. A simpler flow might allow uploading a basic address list, geocoding it, and auto-detecting the county FIPS. Requires conceptual planning — the geocoding step is the main complexity (no backend, so would need a client-side or free API solution).


### Title VI Analysis Module — Implemented
Popup module (`js/projects/title-vi.js` + engine `title-vi-engine.js` +
`projects/title-vi-popup.html`), 3-tab (Policies & Inputs | Analysis |
Scenarios): route-alteration pairing, major-service-change rules,
disparate-impact/disproportionate-burden findings vs. a system baseline,
service loss/gain map overlay, scenario comparison, CSV/GeoJSON/JSON export.

**TODO — golden-value tests deferred:** add `test/cases/title-vi.mjs` once
the engine's math stabilizes (pure pieces: `defaultPolicy`, `createScenario`,
`computeDivergence`, `evaluateMajorChange`, `evaluateFindings`).

**Potential enhancement — New-vs-Old job-access matrix:** the module today
compares demographics of the *impacted area*. A stronger equity output disaggregates
the **change in job access** (not just area demographics) for zero-vehicle,
low-income, and minority populations under a proposed vs. existing network. That
needs job *access* via the planned Transit Travelshed Engine (buffer overlap isn't
accessibility) and the New-vs-Old comparison via Scenario Save & Compare — the
demographic-disaggregation half already lives here.

### OSM Points of Interest — Implemented

Loads curated transit-relevant destination categories from OSM via Overpass (Add Data → ONLINE → "Points of Interest (OSM)"). Category picker (15 types across Health/Education/Transit/Retail/Government/Recreation), auto re-fetched on pan/zoom, rendered as importance-sized purple circles. No session persistence. Exposed as `App.osmPoiFeatures` for downstream modules (see TPI Destinations factor below).

**Potential future enhancements:**
- Filter loaded POIs by importance tier (show only High, Medium, or both)
- User-editable importance override per individual POI via the click detail popup
- Auto-populate `destinationImportance` attribute on new user-placed Points based on proximity to loaded OSM POIs

### GTFS import — Implemented
Upload a GTFS `.zip` via Add Data (+) → GTFS. Renders shapes.txt as dashed reference lines and stops.txt as hollow circles, with hover tooltips and click detail popups (route info pre-joined from trips.txt + routes.txt). Analysis popup shows the file directory (REQ/OPT badges) + scrollable CSV table viewer (capped 500 rows). No session persistence.

**Potential future enhancements:**
- **Derive frequency/span from `stop_times.txt`.** Aggregating stop_times by trip and service period yields real headways and service spans. This unlocks two high-leverage things: (1) a **frequency heatmap overlay** (color route segments by observed headway), and (2) letting the existing **"Copy As Line"** action (`js/projects/gtfs.js:505`) carry real service bands — populate `attributes.service` (weekday / saturday / sunday band arrays) on the copied feature so **Route Costing** and **Trip Builder** consume observed service automatically. Closes the loop from observed feed → editable proposal with no manual band entry.
- **Filter displayed routes by `route_type` / agency, plus a route picker.** Add a route-level selector so users can copy an entire route's pattern (all its shapes) into editable Lines at once, rather than one shape at a time, and toggle visibility by mode/agency.
- **Use a loaded feed as the "existing service" baseline** for Title VI and Ridership Forecasting — compare a proposed network (drawn features) against the current GTFS network for service-change and equity analysis.
- Persist GTFS feed across sessions (localStorage is too small; IndexedDB or a re-upload prompt would be needed)

### Trip Builder — Implemented
Enabled popup module (`js/projects/trip-builder.js`, `projects/trip-builder-popup.html`) that generates a high-level trip schedule (start/end times per direction per day type) for each Service from its underlying Time Bands, frequency, and run time / avg speed. Same Service assembly as Route Costing (`attributes.serviceId` buckets). Per-trip deletion and CSV export per Service.

### Corridor Scoring — Implemented
Enabled popup module (`js/projects/corridor-scoring.js`, `projects/corridor-scoring-popup.html`) that surfaces the per-route Corridor Demand Index as a ranked, objective composite score per drawn route/line. Ranked table with classification pills and expandable per-factor breakdowns, map line layer colored by composite CDI, Adjust Weights modal, CSV/GeoJSON export, and session persistence.

### Ridership Forecasting Directionality Multiplier — Not started
Agreed that full granularity (trunk-with-one-way-loop-ends) exceeds the model's
current fidelity — and importantly, it also exceeds the fidelity of the
*calibration data* (route-level observed ridership), so a segment-level
directionality model would be precision we can't validate.

**What's defensible now — a route-level "directionality factor":**
- We already have the pattern for exactly this kind of adjustment: service
  type premiums (user-adjustable sliders, documented defaults, flow through
  `applyElasticity`). Add a **direction multiplier** derived from the existing
  `direction` attribute / Service pairing: bidirectional (paired patterns or
  "Both") = 1.0; one-way loop (Loop/CW/CCW solo) = default ~0.7,
  user-adjustable with a stated basis. The rationale to document: a one-way
  loop imposes out-of-direction travel for roughly half of trip pairs,
  degrading effective in-vehicle time even at identical headways; empirical
  literature is thin, so the default is a judgment value the user can tune —
  same epistemic status as our service premiums, presented the same way.
- **Calibration-consistency guard (cheap, valuable):** if calibration routes
  are predominantly bidirectional and a scenario is a one-way loop (or vice
  versa), show a warning note — the calibration factor silently embeds the
  direction profile of the routes it was fit on. This costs almost nothing
  (direction attributes are on the features already) and prevents the most
  likely real-world misuse.
- **Hybrid trunk+loops:** representable today as a Service (paired trunk
  patterns) plus loop features, and `computeSegments` shows how per-segment
  treatment *could* work — but defer. A length-weighted blend of per-pattern
  multipliers within a Service is the eventual v2 if demand materializes.
- **Longer-term principled path:** once a transit travelshed engine exists,
  directionality stops being a fudge factor — a one-way loop's travelshed is
  visibly smaller/asymmetric, and accessibility-based demand adjustment
  becomes possible.

**Testing note:** any change to `applyElasticity` or a new multiplier function
is calculation-engine math → golden-value test cases and a
`Verified: node test/run-golden.mjs` line in the commit, per the testing policy.

**Effort:** multiplier + warning = small. Methodology write-up (in
`TPI_Ridership_Forecast_Methodology.md` + the user-facing readme) is the real
deliverable; without it the number is indefensible in front of a client.

### Corridor Scoring scenario compare — Not started
Let users save a scored corridor set as a named scenario and diff two corridor alternatives side by side — a ranked delta table showing which corridors gained/lost score and rank between Scenario A and B. Builds on the module's existing `_lastResult` and session persistence in `corridor-scoring.js`; would add a small scenario store (name + captured `routeCDIs` + weights/settings) and a comparison view. Supports "alternative A vs. alternative B" planning conversations directly in the tool.

### Transit Coverage module — Implemented
Combines Ideas 1+2 from the (now-deleted) brainstorm doc — residents & jobs
near frequent transit. Popup module (`js/projects/transit-coverage.js`,
`projects/transit-coverage-popup.html`): geography/ACS year, module-owned
buffer distance (`js/core/module-buffers.js`), day type + optional peak-headway
threshold (`App.getEffectiveServiceBands`), routes+lines checklist (transit
sources), drawn-polygons checklist (service area/denominator). Coverage/
threshold unions clipped to the service area (`turf.intersect`); aggregates
ACS population (area-apportioned) and LODES jobs (whole-block) into a results
table, stat sentence, map overlay, CSV/GeoJSON export, session persistence.

**Potential future enhancements** (from the original brainstorm, not built):
- User-configurable frequency tiers (≤15/≤30/any) with a "sustained over a
  qualifying span" definition option, vs. today's single threshold
- Municipal boundary polygon as an alternative service-area denominator
- Network walkshed option for buffers (vs. crow-fly) when a road network is loaded
- Buffer from a route's associated stops instead of the line (stop-sparse service)

### Cumulative-Opportunity Transit Accessibility — Not started
What the agencies are showing is **cumulative-opportunity accessibility**,
usually computed with schedule-based multimodal routing (Conveyal/R5: GTFS +
street network, departure-time sampling). We can't and shouldn't replicate
that fidelity client-side — but there is a legitimate, well-established
lighter-weight variant that our data model happens to support almost exactly:
**frequency-based (headway-based) accessibility**, where expected wait =
headway/2 instead of consulting a timetable. Conveyal itself offers this mode
for sketch networks that don't have schedules yet — which is precisely what a
drawn scenario network is.

Conceptual pipeline (all pieces named in the Transit Travelshed Engine entry):
1. Transit travelshed from an origin with budget T (walk → wait → ride →
   walk, ≤1 transfer).
2. "Jobs within T" = LODES jobs within the travelshed polygon (existing
   union-based LODES computation).
3. The headline stat ("the *average resident* reaches 39% more jobs") is the
   population-weighted mean of (2) across many origins — one travelshed per
   populated block-group centroid in the service area. That's the expensive
   part: N origins × multi-flood routing. Tractable as a batch run with a
   progress bar *if* per-stop walk floods are cached and reused across origins
   (design note in the Travelshed entry), or by sampling origins.
4. The "% more" framing is a before/after comparison → falls straight out of
   the Scenario Save & Compare System.

**Opportunity types (beyond jobs):** the same "count what's inside the
travelshed" step generalizes past LODES jobs — count reachable **healthcare
facilities from loaded OSM POIs** (`App.osmPoiFeatures` already carries
hospital/clinic categories) and **low-income households** (ACS), so the headline
can be framed for whichever opportunity a client cares about, not just employment.

**Data we'd want eventually but don't need for v1:** real GTFS-derived
headways for the *existing* network (we already parse GTFS; deriving headways
from `stop_times.txt` is a bounded follow-up), giving an honest "existing
(GTFS) vs proposed (drawn)" comparison.

**Verdict:** don't build this directly. It is the *composition* of the
Transit Travelshed Engine + existing LODES machinery + Scenario Save & Compare.
Methodology disclosure matters for consulting use: frequency-based not
schedule-based, average-wait assumption, transfer cap, no reliability/crowding.

### Transit / Auto Opportunity Ratio — Not started
Kimley-Horn's Access2Opportunity framing (also central to Jarrett Walker's
work): the ratio of opportunities — jobs, healthcare facilities, essential
services — reachable within 30/45/60 minutes **by transit vs. by private auto**,
surfacing the "opportunity gap" and proving where transit is a viable
alternative to driving and where it fails. The transit half is the
Cumulative-Opportunity Transit Accessibility computation above (travelshed ∩
opportunities). The **auto half is feasible entirely offline**: `js/core/road-network.js`
already carries a car-mode Dijkstra (`findLocalRoute`, class-aware `carBlocked`
traversal), so a drive-time travelshed can be flooded from the same origin on
the same graph — no OSRM travel-time matrix, no public-server rate-limit
fragility. Ratio = opportunities(transit-shed) / opportunities(auto-shed),
rendered as a per-origin metric or a choropleth of the gap. Depends on the
Transit Travelshed Engine; the auto comparator is a modest add on the existing
car-mode graph. High consulting-differentiator value.

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

### CSV point import — Implemented
Upload a CSV with lat/lon columns (auto-detected) via Add Data (+) → Spatial Data → point features. `importCSV` (`js/core/cache.js`) also recognizes a geometry_type column for lines/polygons.


### Frequency / service heatmap — Not started
Color route segments by headway or span drawn directly from the route attributes already stored per feature (frequency field in minutes, spanStart/spanEnd). Visual equivalent of a GTFS-based frequency map for proposed service. Could use a diverging color ramp (green = frequent, red = infrequent).

### Frequent Transit Network (FTN) & span visualizer — Not started
A time-of-day slider that filters the drawn network to display only routes running at a chosen headway threshold (e.g. ≤15-min) at the selected time, visually highlighting the **core network** a rider can use without checking a schedule — and emphasizing **span** (how many hours a day that frequency actually holds), which increasingly matters for proving a network serves non-commute trips. Pure client-side: time bands already carry `from`/`to` + `frequency` per day type, and `getEffectiveServiceBands` (`js/core/service-assembly.js`) resolves the active band at any probe time. Complements the Frequency / service heatmap (which colors segments by headway) and the Transit Coverage module (single peak-headway snapshot); the novel pieces are the time-of-day slider and the span roll-up. Could live as a present-mode map overlay or extend Transit Coverage. No new data.

### Transfer connectivity scoring — Not started
Given multiple drawn routes, identify overlap zones and score transfer quality based on shared stop proximity and frequency pairing. Output: a map overlay flagging strong/weak transfer nodes and a summary table.

### Stop spacing analyzer & consolidation optimizer — Not started
Flag segments of a drawn route where stop spacing is too tight (below a minimum threshold) or too wide (above a maximum) vs. a user-configurable target distance, highlighting problematic segments on the map in a distinct color.

**Consolidation economics (Nelson\Nygaard "Smart Stops" framing):** speeding up a route by removing closely-spaced stops is politically contentious, so ground it in data. Given stop Points along a route (they carry `stopId` / `associatedRoutes`), compute average spacing, flag consolidation candidates (e.g. under ¼ mile), and estimate the **run-time saved** per removed stop (a dwell + accel/decel knob, same style as the travelshed boarding penalty) → feed Route Costing's rev-hour math (`js/projects/route-costing.js`) to show **annual operating cost recovery**. Selecting *which* low-ridership stops to cut can use an imported per-stop boardings CSV (CSV point import). No new external data if stops are placed as Points.

### Segment-level delay heatmap — Not started (needs external speed data)
Nelson\Nygaard's right-of-way selling point: map average bus speed vs. posted limit at the segment level to flag "choke points" where transit-priority interventions (bus lanes, signal priority) yield the highest cost savings. **Requires historical AVL or GTFS-RT speed data, which the app does not ingest** — our routes are drawn proposals, not operating vehicles, and GTFS-RT is a streaming feed needing a backend/CORS proxy (against the "just open index.html" model). The only lightweight path: let the user **import a segment-speed CSV** (existing CSV import) keyed to route segments and render it as a heatmap. Deferred until that data path is worth building.

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


### External Data Import — Implemented
Superseded by "Import geospatial data (KML/KMZ/GeoJSON)" above.

### Read-only share link — Implemented
Compressed URL hash (pako-deflated `#share=`) encodes full session state, opening in view-only mode with no backend. `exportShareLink` / share-hash load in `js/core/cache.js`.

### Scenario Save & Compare System — Not started
The instinct here is right, and it's also the architecturally cheap answer: we
already have whole-session export/import with per-module `collect/apply`
persistence, and per-module scenario managers (RF Scenarios tab, Title VI
Scenarios) have proven to be the *expensive* pattern — each one is bespoke UI.

Recommended ladder:

1. **Named session slots (build soon, low effort).** Today localStorage holds
   exactly one session (`"mat-session"`), and file export/import is the only
   way to keep alternatives. Add "Save as scenario…" / "Switch scenario"
   backed by multiple named localStorage keys (same schema, plus a name and
   timestamp). For a non-technical user this converts a fiddly
   export-file-then-reimport dance into a dropdown. Watch localStorage quota
   (~5MB) — sessions are small since LODES isn't cached, but cap slot count
   or fall back to file export gracefully.

2. **Scenario Comparison module (the real payoff).** A system module (like
   Attribute Summary) that loads 2+ scenario states **read-only** and renders
   a side-by-side table of *persisted module results* — not live recomputes.
   This is the key design decision: several modules already persist their last
   summary (`route-costing` lastSummary, `corridor-scoring` lastSummary, RF
   calibration + demand). Comparing those requires **zero Census/LODES calls**
   and no map juggling. Requirements it imposes on new modules: the Transit
   Coverage module should persist its results table in `collect()` from day
   one, specifically so scenarios can be compared (it already does). Each
   compared column shows the run timestamp and a stale flag (results in a
   saved state may predate the features in it — surface that honestly rather
   than recomputing silently).

3. **Side-by-side maps** — defer. High UI cost, and the comparison table plus
   switching scenarios covers most of the consulting need.

**Shortcomings**
- Comparing persisted results means comparing *what was last run*, not a
  guaranteed-fresh computation. Mitigation: prominent timestamps/stale badges,
  and a per-scenario "open & re-run" affordance.
- Cross-scenario normalization: scores like TPI/CDI are normalized within
  their own run's pool, so comparing raw composite scores across scenarios is
  not apples-to-apples (this is the same problem shared-pool mode solves in
  RF). Coverage %, costs, rev-hours, and ridership are absolute and compare
  cleanly — lead with those in the comparison table; badge normalized scores
  with a warning.

**Effort:** slots = small; comparison module = moderate.

### Map export (PNG / PDF) — Not started
Export the current map view as a PNG screenshot (using MapLibre's `map.getCanvas().toBlob()`) or a titled, legended one-page PDF that drops straight into a board deck or grant application. High value, low complexity: pair `map.getCanvas().toBlob()` with a lightweight PDF library (jsPDF) — no backend needed. Reuse the present-mode legend, north arrow, and title overlays from `js/core/present-overlays.js` (and the last analysis run's summary stats) so the exported page matches what's on screen in Present mode.

### Session comments / sticky notes — Not started
Pin a text annotation to a specific map location. Notes persist in the session cache alongside drawn features. Useful for sharing a session with stakeholders who need to mark feedback or flag questions on the map.

---

## UI & Layout

### Stale & empty-state consistency — Not started
Standardize two cross-cutting popup patterns so the whole suite feels coherent. (1) **Stale banner:** most analysis modules already track a `_stale` flag — surface it as a uniform banner ("Inputs changed since last run — re-run to update") with a re-run affordance, instead of each module styling its own. (2) **Friendly empty states:** when a module has nothing to act on, show a one-line prompt ("Draw a route to begin", "Load a GTFS feed to begin") rather than an empty table. **Onboarding-aware:** given the beginner audience (see `CLAUDE.md`), each module's first open should show a one-line "what this needs" hint and lightweight tooltips on key inputs. Could be a shared helper (e.g., `App.renderModuleState({ stale, empty, hint })`) reused by every popup.

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


### Keyboard shortcuts — Implemented
`Escape` cancel/close, `Ctrl+Z`/`Ctrl+Shift+Z` undo/redo, `Delete`/`Backspace` vertex removal, single-key draw-tool toggles (`S`/`L`/`R`/`P`/`M`/`T`/`B`), `Enter` finishes drawing via `App.finishDrawing()`. Wired in `js/app.js`. Possible future polish: shortcuts for analysis modules, a help overlay.



### Print / presentation mode — Implemented
"Present" button hides sidebar/feature panel/toolbar for a full-screen map (Exit button, `Escape` to toggle back). `App.setPresentMode` (`js/app.js`) + `js/core/present-overlays.js` (draggable legend, north arrow, title overlays).

### Classed & diverging legends with editable breaks — Not started
In present mode, support classed and diverging choropleth legends with user-editable break values, rather than only the current continuous/auto legend. Lets a presenter set meaningful thresholds (e.g., headway tiers, or a diverging ramp around a midpoint) and have the legend swatches + map classification update together. Builds on the legend overlay in `js/core/present-overlays.js` and pairs naturally with the Frequency / service heatmap idea (which needs classed headway bins).

## Development & Tooling

### Golden-value test harness — Implemented
Zero-install Node harness (`test/`) that pins pure calculation-function output in a Node `vm` sandbox (no browser/npm/build). Covers Ridership Forecasting, TPI, Route Costing, Trip Builder, Corridor Scoring, Transit Coverage, and Module Buffers; Title VI is intentionally deferred (see its entry above). Run with `node test/run-golden.mjs`; `--update` re-records after a deliberate change. Full workflow in `test/README.md`.

### Automated test runs on push (GitHub Actions CI) — Not started (future decision)
Today the golden tests run only when a person or the agent invokes them — the `CLAUDE.md` instruction makes that a reliable *habit*, but not a hard gate: if a session skips it, nothing physically blocks a bad number from being committed. A small GitHub Actions workflow (~15 lines) would run `node test/run-golden.mjs` automatically on every push / pull request, showing a green check or red ✗ on the branch and optionally blocking merge when red — a server-side guarantee that holds regardless of whether any session remembers. Because the harness needs no install (just Node), the workflow is minimal: check out the repo, set up Node, run the one command. **Recorded as a future decision, not a blocker** — the habit route is already live. Worth adding when a hard gate becomes valuable (e.g., more people/agents touching the calculation engines, or ahead of a release). No app-code impact: it is a single `.github/workflows/*.yml` file and changes nothing about the buildless, static nature of the app.
