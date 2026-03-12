# Transit Propensity Index (TPI) — Phased Implementation Plan

## Overview

A **Transit Propensity Model** to evaluate potential for fixed-route or rapid bus service along a corridor. The model scores census geographies (tracts or block groups) on demographic, socioeconomic, and mobility factors, applies user-configurable weights, and produces a composite **Transit Propensity Index (TPI)** rendered as a choropleth map.

This plan is organized into **4 phases**, from core scoring engine through ArcGIS-ready exports. Each phase produces a working, testable increment.

---

## Capability Assessment

### What Our Tool Already Does

| Capability | Where It Lives | Relevance to TPI |
|-----------|----------------|-------------------|
| Census ACS 5-year API fetch | `js/core/census.js` | Core data source for all demographic factors |
| TIGERweb geometry queries (tracts, block groups) | `js/core/census.js` | Census boundaries for scoring and choropleth |
| Area-weighted aggregation (sum + average) | `js/core/census.js` | Aggregation engine for factor computation |
| Corridor buffers (stations, lines, routes) | `js/core/stations.js`, `lines.js`, `routes.js` | Defines the analysis area |
| Buffer union polygon | `stations.js` / `app.js` | Single dissolved boundary for census queries |
| LODES employment data (block-level) | `js/core/lodes.js` | Employment density factor |
| Project plugin system | `js/app.js` `registerProject()` | TPI plugs in as a new project |
| FTA breakpoint scoring | `js/projects/fta-small-starts.js` | Pattern to follow for classification UI |
| Session export/import (JSON) | `js/core/cache.js` | Pattern for file export |
| ACS variables: total pop, households, zero-car HH, poverty | `js/core/utils.js` VAR_META | 4 of 9 TPI factors already fetchable |

### What We Need to Add (Phases 1–3 below)

| Need | Approach |
|------|----------|
| 5 new demographic factors (senior, youth, disability, POC, LEP) | Batch ACS API fetch of ~35 variable codes |
| Per-geography scoring (not just one aggregate number) | Compute raw values per tract/BG, then normalize |
| Quantile normalization (1–5 scores) | Rank geographies within corridor, assign quintiles |
| Configurable weights | HTML range sliders, 9 factors, must sum to 100% |
| Composite TPI calculation | Weighted sum of normalized scores |
| Choropleth map layer | MapLibre data-driven `fill-color` on geography polygons |
| Legend + hover tooltips | Sidebar panel + MapLibre Popup |
| GeoJSON/CSV export | Scored features for ArcGIS Pro overlay |

### What Must Be Done in External Tools (Phase 4)

| Factor | Why It Can't Be Browser-Side | Recommendation |
|--------|------------------------------|----------------|
| Land use intensity (FAR, mixed-use) | Requires local parcel/zoning data not in Census | Overlay TPI GeoJSON with local zoning in ArcGIS Pro |
| Proximity to schools, health facilities | Requires geocoded facility datasets | Could add as user-uploaded CSV in a future phase (same pattern as FTA Essential Services) |
| Proximity to existing transit stops | Requires GTFS feed | Could add as user-uploaded GTFS stops CSV in a future phase |
| Sidewalk/trail connectivity | Requires local infrastructure GIS data | ArcGIS network analysis only |
| Transit-supportive zoning | Requires local zoning classification | ArcGIS overlay only |

---

## File Plan

### New Files

| File | Purpose |
|------|---------|
| `js/projects/transit-propensity.js` | Main project JS — scoring engine, choropleth, export (~600–800 lines) |
| `projects/transit-propensity.html` | Main sidebar panel (compute button, results, export buttons) |
| `projects/tpi-weights.html` | Sub-panel: 9 weight sliders |
| `projects/tpi-legend.html` | Sub-panel: color legend + display toggles |
| `css/tpi.css` | Slider styles, legend swatches, factor table, stale indicator |

### Files to Modify

| File | Change |
|------|--------|
| `index.html` | Add `<link>` for `css/tpi.css`; swap FTA `<script>` tag to TPI |

**No core files modified.** The TPI lives entirely in the project plugin system.

---

## ACS Variable Codes

### Existing (reuse from core)

| Variable | Code | TPI Use |
|----------|------|---------|
| Total population | `B01003_001E` | Density + rate denominator |
| Total households | `B11001_001E` | Zero-car % denominator |
| Zero-car households | `B08201_002E` | Mobility factor |
| Persons below poverty | `B17001_002E` | Low-income factor |

### New (fetched inside TPI project via batch API call)

| Factor | ACS Codes | Computation |
|--------|-----------|-------------|
| **Senior 65+** | Males: `B01001_020E` thru `B01001_025E` (6 vars); Females: `B01001_044E` thru `B01001_049E` (6 vars) | Sum 12 age bins |
| **Youth <18** | Males: `B01001_003E` thru `B01001_006E` (4 vars); Females: `B01001_027E` thru `B01001_030E` (4 vars) | Sum 8 age bins |
| **Disability** | Males w/ disability: `B18101_004E`, `_007E`, `_010E`, `_013E`, `_016E`, `_019E`; Females: `_023E`, `_026E`, `_029E`, `_032E`, `_035E`, `_038E`; Denominator: `B18101_001E` | Sum 12 vars / denominator |
| **Minority** | Total: `B03002_001E`; NH White alone: `B03002_003E` | `(total − NH White) / total` |
| **LEP** | 12 "speak less than very well" vars: `C16001_005E`, `_008E`, `_011E`, `_014E`, `_017E`, `_020E`, `_023E`, `_026E`, `_029E`, `_032E`, `_035E`, `_038E`; Denominator: `C16001_001E` | Sum 12 vars / denominator |

**Total new ACS codes: ~35.** The Census API allows up to 50 variables per GET request, so all codes fit in a single batch call per state-county group.

---

## TPI Factors and Default Weights

| # | Factor | Raw Value Formula | Default Weight |
|---|--------|-------------------|---------------|
| 1 | Population Density | `B01003_001E / area_sq_mi` | 15% |
| 2 | Employment Density | `LODES C000 / area_sq_mi` | 15% |
| 3 | Zero-Vehicle HH % | `B08201_002E / B11001_001E × 100` | 12% |
| 4 | Low-Income % | `B17001_002E / B01003_001E × 100` | 12% |
| 5 | Senior 65+ % | `sum(age 65+ bins) / B01003_001E × 100` | 10% |
| 6 | Disability % | `sum(disability vars) / B18101_001E × 100` | 10% |
| 7 | Minority % | `(B03002_001E − B03002_003E) / B03002_001E × 100` | 10% |
| 8 | Youth <18 % | `sum(age <18 bins) / B01003_001E × 100` | 8% |
| 9 | LEP % | `sum(LEP vars) / C16001_001E × 100` | 8% |

Weights sum to 100%. If LODES is not loaded, employment density is excluded and its 15% is redistributed proportionally across the other 8 factors.

---

## Phase 1: Core Scoring Engine + Basic UI

**Goal**: Compute and display TPI scores for all intersecting geographies. No map choropleth yet — results shown in a table.

### Steps

1. **Create `css/tpi.css`**
   - Factor summary table styles
   - Status card styling (reuse patterns from `sidebar-v2.css`)
   - "Computing..." progress indicator

2. **Create `projects/transit-propensity.html`**
   - Geography level dropdown (tract / block group)
   - ACS year dropdown (2021–2023)
   - [Compute TPI] button
   - Results summary card: # of geographies, average TPI, max TPI, min TPI
   - Factor summary table: factor name | weight | avg raw value | avg score
   - Status text area for progress messages

3. **Create `js/projects/transit-propensity.js` — Phase 1 portion**
   - IIFE wrapper, `App.registerProject()` call
   - **Factor definitions**: array of 9 factor objects with name, ACS codes, computation function, default weight
   - **`fetchACSBatch(geoLevel, year, varCodes, geoids)`**: Multi-variable Census API fetch. Same grouping logic as `census.js:fetchACSValues` but requests all ~35 codes in a single comma-separated `?get=` parameter per state-county group. Returns `Map<geoid, {varCode: value}>`.
   - **Per-geography factor computation**: For each tract/BG, compute raw values (densities, percentages) from the batch-fetched data
   - **LODES aggregation**: Aggregate block-level LODES data to tract/BG level using GEOID prefix matching (block GEOID starts with parent tract or BG GEOID)
   - **Quintile normalization**: For each factor, rank all geographies, assign scores 1–5 by quintile. Fallback to min-max linear scaling if <5 geographies. Missing data → score 0 (excluded)
   - **Composite TPI**: `TPI(geo) = Σ(weight[f] × score[f])` where weights sum to 1.0. Result range ~1.0–5.0
   - **In-memory cache**: Store raw ACS data and geography features so weight changes don't require new API calls
   - **Results display**: Populate the factor summary table and summary stats

4. **Update `index.html`**
   - Add `<link rel="stylesheet" href="css/tpi.css" />`
   - Replace FTA script tag: `<script src="js/projects/transit-propensity.js"></script>`

### Verification
- Place stations in a metro area, click Compute TPI
- Verify factor summary table shows all 9 factors with scores
- Verify summary stats (avg, min, max TPI) are reasonable
- Test with and without LODES data loaded

---

## Phase 2: Choropleth Map + Legend

**Goal**: Render TPI scores as colored geography polygons on the map. Add legend and hover tooltips.

### Steps

1. **Add choropleth rendering to `transit-propensity.js`**
   - MapLibre GeoJSON source (`"tpi-choropleth"`) with `tpiScore` in feature properties
   - Fill layer with `interpolate` expression for graduated color:
     ```
     1.0 → #eff3ff (lightest blue)
     2.0 → #bdd7e7
     2.5 → #6baed6
     3.0 → #3182bd
     3.5+ → #08519c (darkest blue)
     ```
   - Fill opacity: 0.65 (basemap visible underneath)
   - Insert layers below `"buffers-fill"` so buffer outlines stay on top
   - Thin outline layer (0.5px, dark) to distinguish geographies
   - `clearChoropleth()` function to remove/hide layers

2. **Add hover tooltip**
   - `mousemove` listener on the TPI fill layer
   - MapLibre Popup showing: GEOID, composite TPI score, and individual factor scores
   - `mouseleave` to dismiss

3. **Create `projects/tpi-legend.html`**
   - 5 color swatches with score ranges (Low, Low-Med, Medium, Med-High, High)
   - Checkbox: "Show geography outlines"
   - Checkbox: "Clip to buffer boundary" (clips rendered geographies to union polygon using `turf.intersect`)

4. **Update `css/tpi.css`**
   - Legend swatch styles (colored boxes with labels)
   - Tooltip content styling

5. **Wire instant re-render on weight change**
   - When weights change and cached data exists, re-normalize + re-score + update source data
   - No new API calls — only the scoring and MapLibre source update
   - Choropleth updates in <100ms

### Verification
- Compute TPI → colored geographies appear under buffer outlines
- Hover over a geography → popup shows scores
- Switch basemap to dark → verify colors still legible
- Toggle outlines on/off
- Clear choropleth → map returns to normal

---

## Phase 3: Weight Sliders + Export

**Goal**: User-adjustable factor weights. GeoJSON and CSV export for ArcGIS integration.

### Steps

1. **Create `projects/tpi-weights.html`**
   - 9 range sliders (`<input type="range" min="0" max="50">`)
   - Each shows: factor label | slider | current % value
   - Running total at bottom with red warning if ≠ 100%
   - [Reset to Defaults] button
   - Compute button disabled when weights don't sum to 100%

2. **Add weight event handling to `transit-propensity.js`**
   - `input` event listeners on all sliders
   - Update weight total display
   - If cached data exists, trigger instant re-score + re-render
   - Persist weight preferences to `localStorage`

3. **Add stale-data detection**
   - `update()` hook detects when stations/buffers change after TPI computation
   - Orange "Data may be stale — click Compute TPI to refresh" banner
   - Does NOT auto-recompute (API calls are expensive)

4. **Add GeoJSON export**
   - [Export GeoJSON] button on main panel
   - Generates FeatureCollection where each feature has:
     ```
     properties: {
       GEOID, tpiScore, tpiClass,
       popDensity_raw, popDensity_score,
       zeroCar_raw, zeroCar_score,
       ... (all 9 factors with _raw and _score)
       weights: { popDensity: 15, employment: 15, ... }
     }
     ```
   - Blob download with timestamped filename: `tpi-export-2026-02-19.geojson`
   - Loadable directly into ArcGIS Pro, QGIS, or any GIS tool

5. **Add CSV export**
   - [Export CSV] button on main panel
   - Flat table: GEOID, TPI_Score, TPI_Class, then raw + score columns for each factor
   - Timestamped filename: `tpi-export-2026-02-19.csv`

### Verification
- Adjust sliders → verify weight total updates, warning appears/disappears
- Adjust weights with cached data → choropleth re-colors instantly
- Reset to defaults → sliders snap back to original values
- Move a station → verify stale indicator appears
- Export GeoJSON → open in QGIS or geojson.io, verify geometry + properties
- Export CSV → open in Excel/Google Sheets, verify columns and values

---

## Phase 4: ArcGIS Integration and Future Extensions

**Goal**: Prepare the tool's output for overlay with external datasets in ArcGIS Pro. Plan extensibility for additional factors.

### 4A. ArcGIS Integration (GeoJSON export is the bridge)

The GeoJSON export from Phase 3 enables these ArcGIS workflows:

| Workflow | Steps in ArcGIS Pro |
|----------|---------------------|
| **Land use overlay** | Import TPI GeoJSON → Spatial Join with local zoning/parcel layer → add land use intensity score |
| **Proximity analysis** | Import TPI GeoJSON → Near tool with school/health/transit facility points → add proximity scores |
| **Transit stop overlay** | Import GTFS stops → Buffer 0.25 mi → Spatial Join with TPI geographies |
| **Sidewalk connectivity** | Import TPI GeoJSON → Network Analyst with sidewalk layer → add walkability score |
| **Combined scoring** | Join all additional factor scores to TPI table → recompute weighted composite |

The web tool handles the Census-based factors; ArcGIS handles the local-data factors. The `GEOID` field is the join key between them.

### 4B. Future Web Tool Extensions (post-Phase 3)

These could be added in later development cycles:

| Extension | Approach | Effort |
|-----------|----------|--------|
| **User-uploaded facility points** (schools, health, transit stops) | Follow FTA Essential Services pattern: CSV/GeoJSON upload → count within buffer → proximity score | Medium — pattern exists |
| **GTFS transit stop integration** | Upload GTFS stops.txt → parse → plot on map → count near each geography | Medium |
| **Custom factor upload** | Let user upload a CSV with GEOID + custom score → inject as additional TPI factor | Medium |
| **Comparison mode** | Compute TPI for two corridors side by side → table comparing factor averages | Large |
| **Time series** | Compute TPI for multiple ACS years → show change over time | Medium (UI complexity) |
| **Census API key support** | Optional API key field → appends `&key=` to requests → avoids rate limits | Small |

---

## Data Flow Diagram

```
User clicks [Compute TPI]
    │
    ▼
1. Get buffer union polygon
   (App.bufferUnionPolygon — combines station + line + route buffers)
    │
    ▼
2. Fetch TIGERweb census geographies intersecting union
   (App.fetchTigerwebGeos — returns tract or BG polygons with GEOIDs)
    │
    ▼
3. Compute area (sq mi) of each geography
   (turf.area → convert m² to mi²)
    │
    ▼
4. Batch-fetch all ~35 ACS variable codes in one API call per state-county group
   (new fetchACSBatch function — returns Map<GEOID, {varCode: value}>)
    │
    ▼
5. If LODES loaded: aggregate block-level C000 to each tract/BG
   (GEOID prefix matching — block GEOIDs start with parent tract/BG GEOID)
    │
    ▼
6. Compute 9 raw factor values per geography
   (densities = count / area; percentages = numerator / denominator × 100)
    │
    ▼
7. Normalize: quintile scoring 1–5 for each factor across all geographies
   (rank, divide into 5 equal bins, assign score)
    │
    ▼
8. Apply user weights → composite TPI per geography
   (TPI = Σ weight × score, range ~1.0 to 5.0)
    │
    ▼
9. Cache raw data + scores in memory
   (weight changes re-run steps 7–8 only, no new API calls)
    │
    ▼
10. Render choropleth on map + populate summary table
    (MapLibre data-driven fill + factor table in sidebar)
```

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Census API rate limiting (500 calls/day without key) | Batch fetch minimizes calls (~1–3 per computation vs ~35); add API key support in Phase 4 |
| Too few geographies for meaningful quintiles (<5) | Fall back to min-max linear scaling |
| Weights not summing to 100% | Client-side validation; disable Compute button until valid |
| Choropleth hidden behind buffer layers | Use `"before"` parameter in `map.addLayer()` to insert below buffers |
| User confusion about stale data after moving stations | Orange stale-data banner with explicit instruction to recompute |
| LODES not loaded for employment density | Exclude factor, redistribute its weight proportionally |
| Large areas with many geographies (>200 tracts) | Progress indicator during fetch + compute; consider geography level recommendation |

---

## Summary

| Phase | Deliverable | Depends On |
|-------|-------------|------------|
| **Phase 1** | Scoring engine + factor table in sidebar | Nothing (start here) |
| **Phase 2** | Choropleth map + legend + tooltips | Phase 1 |
| **Phase 3** | Weight sliders + GeoJSON/CSV export | Phase 1 |
| **Phase 4** | ArcGIS integration guide + future extensions | Phases 1–3 |

Phases 2 and 3 can be developed in parallel once Phase 1 is complete.
