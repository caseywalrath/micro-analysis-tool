BEGIN PLAN
Corridor Scoring Module
Context

The app today has two overlapping but differently-oriented modules:

Transit Propensity Index (TPI) — outputs per-geography scores; the map
(land) is the product.
Ridership Forecasting (RF) — uses per-route CDI internally as an input to
calibration/forecasting; the per-route score is never the final deliverable.
The user wants a third outcome: a ranked, defensible, objective score per
corridor that holistically characterizes draft/hypothetical routes based on
their surrounding land use and equity factors. Not geography-focused (TPI), not
ridership-focused (RF) — just "here is a composite score for each corridor under
review" to pair with qualitative analysis.

The underlying engine already produces exactly this number:
RidershipModel.computePerRouteCDI() returns per-route CDI with factor
breakdowns. The work is to surface it as a first-class endpoint in its own
module, not an intermediate step.
Approach

Add a new standalone analysis module corridor-scoring ("Corridor Scoring")
that wraps the existing per-route CDI engine. Normalization pool is the union
of only the routes the user selects (apples-to-apples comparison of drafts).
Output is a ranked table + score-colored route map + CSV/GeoJSON export.
Why a new module (not extending TPI or RF)

TPI's purpose is geography scoring; adding route rollups dilutes that.
RF is structured around a 4-tab calibrate-then-forecast workflow; a
"stop after Step 1" mode would hide the tool inside a forecasting module.
A clean third module keeps each tool's purpose crisp and reuses the engine.

Files
New files

js/projects/corridor-scoring.js — module registration, state,
UI wiring, map rendering, exports.
projects/corridor-scoring-popup.html — 2-column popup body
(Settings | Results), modeled on transit-propensity-popup.html.
projects/corridor-scoring-legend.html — floating legend fragment,
5-class Blues ramp (reuse styling from tpi-legend.html).

Modified files

index.html — add one <script src="js/projects/corridor-scoring.js">
tag after app.js (order doesn't matter relative to other modules; must be
after ridership-scoring.js since we call window.RidershipModel).
css/style.css — add a .cs- prefixed block near the .tpi- / .rf-
blocks. Score pill colors reuse existing .pill.high through .pill.low.
CLAUDE.md — add a section describing the new module (conventions note
expects this).

Reused engine (no changes needed)

All heavy lifting already exists:

RidershipModel.computeSystemDemand({ geoLevel, year, weights, lodesData, apportionByArea, unionPolygon, featureFilter, onProgress })
→ js/projects/ridership-scoring.js:330 — runs TPI once, returns
{ tpiResult, systemCDI, routeCDIs }.
RidershipModel.computePerRouteCDI(tpiResult, featureFilter)
→ js/projects/ridership-scoring.js:193 — produces the ranked array with
{ name, featureType, featureIndex, cdi, classification, factorBreakdown, compositeRange, lengthMiles, geoCount }.
RidershipModel.buildUnionFromFeatures(featureFilter)
→ js/projects/ridership-scoring.js:78 — builds the custom study-area
polygon so quintiles are normalized over the selected routes only.
RidershipModel.classifyCDI(score) → for the classification pill.
TPI.getDefaultWeights() → default factor weights.

Reused UI patterns (copy, don't share)

The Calibrate tab Step 1 in RF is a working prototype of the UI the user wants.
We copy — not share — the following patterns into the new module, renamed with
cs- prefix so future changes in either module stay independent:

Feature checklist (buildFeatureChecklist pattern from
transit-propensity.js) — routes + lines only; points and polygons not
applicable to corridor scoring.
"Adjust Weights" modal overlay (9 factor sliders, Confirm/Cancel/Reset) —
same HTML structure as the TPI modal.
Expandable per-route row with factor breakdown bars — pattern from
buildRouteFactorBreakdownHTML() in ridership-forecasting.js:~1374.
LODES warning icon next to ACS Year (⚠ tooltip when LODES not loaded).
"Stale" banner when inputs change after a run (_stale flag pattern used
in TPI/RF).

UI layout

Popup width 960px, 2-column:
Settings column (left, 240px fixed)

Geography level [bg / tract]
ACS Year [2024 ▾] ⚠ (LODES warning)
[ ] Apportion by area
Corridors to score
[x] Route 1
[x] Route 2
[ ] Line 1
[Adjust Weights…]
[Score Corridors]

Results column (right, flex)

Status: "Scored 3 corridors — 47 block groups"
Rank Corridor Score Classification
1 Route 2 4.12 [High pill] [▸]
2 Route 1 3.08 [Medium pill] [▸]
3 Line 1 2.34 [Low-Medium pill] [▸]

(click ▸ to expand)
Factor Quintile bar Value
Pop density ████░ 4.2 5,230/mi²
Employment ███░░ 3.1 1,840/mi²
…

[Export CSV] [Export GeoJSON]

Map

Draws a choropleth-style line layer: each scored route colored by a 5-class
Blues ramp keyed to its composite score.
Floating legend at bottom-left (reusing the App.popup.showFloatingWidget
path; legend HTML is a new fragment mirroring tpi-legend.html).
Legend auto-shows on successful scoring, persists independently of the
popup (same pattern as TPI/RF legends).

Module internals (public API on window.App — none required)

The module registers itself via App.registerModule({...}) and does not need
to expose anything new on App. All state is private to the IIFE closure.
Module-local state

_weights (copy of TPI.getDefaultWeights(), independent of TPI/RF weights)
_pendingWeights (while modal is open)
_featureFilter ({ routeIndices, lineIndices } or null)
_lastResult ({ routeCDIs, geoLevel, year, apportionByArea, unionPolygon })
_stale, _running, _initialized, _apportionByArea

Core flow

User picks geography, year, features, optionally weights.
Click Score Corridors:
    buildUnionFromFeatures(_featureFilter) → study-area polygon (selected
    routes only, so quintiles are normalized relative to this set).
    RidershipModel.computeSystemDemand({ ..., unionPolygon, featureFilter })
    → gets tpiResult + routeCDIs.
    Sort routeCDIs by CDI descending for ranked display.
Render table, paint routes on map, show legend, enable exports.

Exports

CSV: rank, name, feature type, feature index, CDI score, classification,
length (mi), geo count, per-factor quintile columns, composite min/max range.
GeoJSON: FeatureCollection of the scored routes/lines (source geometry
from App.routes / App.lines) with properties: name, cdi, classification,
rank, factor breakdown object, weights snapshot, geoLevel, year.

Session persistence

Register with App.cache.registerModule("corridor-scoring", { collect, apply }):

collect("light"): weights, featureFilter, apportion flag, last score summary
(no geos).
collect("full"): adds the TPI geos so the choropleth can restore on file
import (same pattern TPI and RF already follow).
apply(data): restore state, re-render map/legend if _lastResult present.

Testing / verification

Because this is a browser-only app (no build, no test runner), verify by
opening index.html and walking the golden path:

Draw 2–3 routes on the map.
Open Analysis → Corridor Scoring.
Confirm the feature checklist lists all drawn routes/lines.
Select a subset, click Score Corridors.
Verify:
    Ranked table renders with distinct CDI values (not all identical — the
    selected-routes-only union should produce a real quintile spread).
    Clicking a row expands the factor breakdown.
    Routes on the map are color-coded by score; legend appears at
    bottom-left.
    CSV and GeoJSON exports download with expected columns/properties.
Change weights via Adjust Weights, confirm stale banner appears, re-run.
Toggle LODES on/off, confirm ⚠ icon and employment factor redistribution.
Reload the page — confirm weights/selection restore from session cache;
confirm choropleth restores from a file-exported session.
Cross-check: scores should differ from (not equal) the CDI values shown
in RF's Calibrate tab when a different feature subset is selected, because
the normalization pool is different.

Out of scope (explicitly)

No narrative summary text (user excluded this output).
No calibration, no ridership multipliers, no elasticity — that's RF's job.
No cross-module sharing of the normalization pool with TPI/RF.
No per-segment scoring within a corridor (RF already does that).

END PLAN
