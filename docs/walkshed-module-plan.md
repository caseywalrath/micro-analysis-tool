# Walkshed Module — Design Brief

**Status:** Design brief for a fresh implementation session. Not yet built.
**Author context:** Drafted while evaluating a client-side walkshed approach ("Option C") for a separate DOT walkshed engagement. This module is the in-house proof that a **usable network walkshed can be computed entirely in-browser using data the app already owns** — no runtime external service.

---

## 1. Goal

Add a **Walkshed** capability: from a placed Point, compute a true walking-network **isochrone polygon** (e.g. a 15-minute walkshed) and render it on the map — as an alternative/supplement to the existing circular buffer. The walkshed polygon should be consumable by the app's existing demographic analysis (Buffer-Area Summary, TPI, etc.) exactly the way the circular buffer union is today.

This directly delivers the long-standing `features.md` item **"Walkshed polygons — Low Priority"** ("Compute an isochrone/walkshed polygon from a selected point… The walkshed polygon could replace or supplement the circular buffer").

## 2. Key insight — almost everything already exists

`js/core/road-network.js` is a complete in-browser routing engine. A walkshed reuses ~90% of it:

| Capability | Where it lives | Reuse for walkshed |
|---|---|---|
| Road network → topological graph (`Map<coordKey, [{node, weight(km), coords}]>`) | `road-network.js` `buildGraph()` (L44) | **As-is.** Nodes are keyed by 6-decimal coordinate rounding, so shared intersection coords auto-connect. |
| Snap an arbitrary point to the network | `snapToNetwork()` (L102) | **As-is.** Snap the walkshed origin point. |
| Temp snap-node injection + cleanup | inside `findLocalRoute()` (L240–280) | **Reuse the pattern** to inject the origin as a graph node. |
| Dijkstra | `dijkstra(startKey, endKey)` (L185) | **Adapt.** Existing version is point-to-point (early-exits at `endKey`). Walkshed needs a **one-to-many flood** to a distance budget. |
| Load network from **file** (no Overpass) | `App.loadRoadNetworkFromFile(file)` (L427) | **Critical.** Lets us pre-download/import the network once and compute walksheds with zero live calls. |
| Load network from Overpass | `App.fetchRoadNetwork()` (L315), Add Data → "Area Roads for Street Routing" (`index.html:102`) | Optional convenience path. |
| Export network to GeoJSON | `App.exportRoadNetwork()` (L448) | Enables a pre-bundled/importable network. |
| Circular buffer + union that Census consumes | `points.js` `rebuildBuffers()` (L108), `bufferUnionPolygon()` (L132) | **Integration target** — walkshed should feed the same downstream consumers. |

**The only genuinely new algorithm is a budget-limited flood Dijkstra + a polygon builder.** Everything else is wiring.

> Note on the earlier standalone spike (`walkshed-isochrone-spike.html`): it hit `NetworkError` because it called Overpass live from a restricted context. This module avoids that entirely by consuming the **already-loaded / file-imported** road network — the same reason Option C is attractive for the DOT app.

## 3. What to build

### 3.1 New engine function (in `road-network.js`, keeps the graph private)

Add and export:

```
App.computeWalkshed(lngLat, budgetKm, options) -> {
  polygon,            // turf Polygon/MultiPolygon (the walkshed)
  reachableSegments,  // FeatureCollection of reachable street LineStrings (visual proof it follows the grid)
  reachableCount,     // node count within budget
  snap                // the snapped origin (or null if outside network)
} | null
```

Algorithm:
1. `snapToNetwork(lngLat)`; if null → return null (origin outside coverage).
2. Inject the snapped origin as a temp node (reuse `injectSnapNode` / `cleanupTempNodes` pattern from `findLocalRoute`).
3. **Flood Dijkstra**: same heap, but no `endKey`; keep expanding while `dist <= budgetKm`. Record `dist` for every settled node.
4. Collect nodes with `dist <= budgetKm` and edges where **both** endpoints are within budget → `reachableSegments`.
5. Build `polygon` (see 3.2).
6. `cleanupTempNodes()` in a `finally`.

`budgetKm = walkSpeedKmh * (minutes / 60)`. Graph weights are already in **kilometers** (turf.distance default in `buildGraph`), so no unit conversion needed.

### 3.2 Polygon builder

- **v1:** concave hull of reachable node coordinates — `turf.concave(fc, { maxEdge, units:'kilometers' })` with an **auto-relax loop** (increase `maxEdge` until non-null; fall back to `turf.convex`). Same approach proven in the spike.
- **v2 (quality upgrade, note only):** buffer the `reachableSegments` by ~20–30 m and `turf.union` them for a boundary that hugs the streets. More robust/realistic, heavier compute. Leave as a follow-up.

### 3.3 Module + UI (follow the app's module conventions)

Register a popup module per `CLAUDE.md` ("How to add a new analysis module"):
- `js/projects/walkshed.js` (`App.registerModule({ id: "walkshed", ... })`) + `projects/walkshed-popup.html`; add the `<script>` to `index.html` after `app.js`.
- **Settings:** minutes (default 15), walk speed km/h (default 4.8), target = a selected Point or all Points, hull `maxEdge` (advanced), a **Compute** button.
- **Empty/onboarding state** via `App.renderModuleState()`: if `!App.roadNetworkLoaded()`, show the hint *"Load a road network first: Add Data → Area Roads for Street Routing, or import a saved road-network GeoJSON."* (points the user at both paths, including the file-import path that avoids Overpass).
- **Results:** per-point walkshed area (km²/mi²), reachable-node count, compute time; render the walkshed polygon layer + (optionally) the green reachable-segments layer as a correctness check.
- **Export:** GeoJSON of the walkshed polygon(s).
- **Stale handling** via the standard `renderModuleState` pattern when points or the network change.

### 3.4 The high-value integration (make walksheds first-class study areas)

The real payoff: let a walkshed **stand in for the circular buffer as the study-area geometry** that Census/LODES aggregation runs on. Downstream modules already consume `App.bufferUnionPolygon()` (Buffer-Area Summary, TPI via union). Design so a computed walkshed can be used as that study polygon — e.g. a per-point "service area type" (circular buffer *or* walkshed) whose union feeds the existing pipeline. Recommended sequencing:
- **v1:** walkshed renders as its own layer + exports; demographic reuse is manual (export → re-import) or deferred.
- **v2:** walkshed union becomes a selectable study-area source for Buffer-Area Summary / TPI, so "demographics within a 15-min walk of each station" works with **no new Census code**. This is the feature that matters most for the DOT use case — prioritize it right after v1 renders correctly.

## 4. Edge cases & guards

- **No road network loaded** → onboarding hint (3.3); disable Compute.
- **Origin snaps > `SNAP_MAX_KM` (0.5 km) from network** → skip that point with a clear per-point warning.
- **Sparse/disconnected network** → walkshed may be small/empty; surface reachable-node count so the user sees why.
- **Large budgets / many points** → flood is O(E log V) per point; fine for a loaded regional network, but cap minutes (e.g. ≤ 60) and compute points sequentially with a status update.
- **Concave hull artifacts** → rely on the reachable-segments layer as the trustworthy signal; the hull is presentation.
- **Units** → budget and weights both in km; keep it that way to avoid conversion bugs.

## 5. Persistence

- Walkshed polygons are cheap to recompute from (point + settings + loaded network), so **v1 need not persist polygons** — persist only the module settings (minutes/speed) via `App.cache.registerModule("walkshed", …)` if desired. The road network itself is already not persisted (re-import/re-download per session), matching current behavior.

## 6. Validation plan

- **Visual:** walkshed should hug the street grid (compare to the circular buffer on the same point — it should be smaller and irregular, not a circle).
- **Benchmark:** compare against an OpenRouteService `foot-walking` isochrone for a few origins (urban core, suburb, network edge) — shape/extent should be reasonably close.
- **Performance:** record compute time; target ~1–2 s per point on a loaded regional network.
- **Integration (v2):** confirm Buffer-Area Summary / TPI produce sensible demographics when run against a walkshed study area.

## 7. Scope boundaries

- **In (v1):** single/selected Points, one contour, concave-hull polygon, uses the already-loaded/imported road network, render + area + GeoJSON export.
- **In (v2):** walkshed as a study-area source for existing demographic modules; multi-contour rings; buffer-union boundary.
- **Out:** statewide tiled network, slope-adjusted times, transit subcategory, live/streaming network fetch as a dependency (import/preload instead).

## 8. Files to touch

- `js/core/road-network.js` — add `computeWalkshed()` + flood Dijkstra + polygon builder; export on `App`.
- `js/projects/walkshed.js` — new module (register, settings, run, render, export, stale/empty state).
- `projects/walkshed-popup.html` — popup body.
- `index.html` — add the module `<script>` tag; (v1 renders its own map layer).
- `css/style.css` — module styles (`.walkshed-` prefix) + the walkshed fill/line layers.
- `features.md` — flip "Walkshed polygons" to **Partial/Implemented** with a pointer here.
- `CLAUDE.md` — add the module to the File Structure + module list once built.
