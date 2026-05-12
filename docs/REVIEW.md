# Code Review — 2026-05-12

## Summary
This branch keeps the project within the documented no-build, browser-only architecture, but the highest-risk issues are analytical correctness and recovery from bad imported state. The new Trip Builder and Route Costing work added another copy of service assembly and service-band semantics, and that duplication has already produced divergent behavior. The cache/import path still trusts too much of the session file before mutating live state, which conflicts with the stated need for recoverability. The most likely next user-visible bugs are silent wrong Sunday service outputs, wrong ACS/TPI numbers that look plausible, and import-driven XSS or browser freezes.

## Critical

### Honor the Sunday mirror flag before using service bands
**Where:** `js/core/feature-attributes.js:594`, `js/core/feature-attributes.js:747`, `js/projects/route-costing.js:520`, `js/projects/trip-builder.js:296`
**What:** The feature-attribute editor stores a `service.sundayMirrorsSaturday` flag and hides the Sunday band editor when it is checked, but it only renders a preview of Saturday bands. Route Costing and Trip Builder read `p.service[day]` directly for `weekday`, `saturday`, and `sunday`; neither module resolves the mirror flag into effective Sunday bands.
**Why it matters:** A user can explicitly choose “Mirror Saturday” and then get zero Sunday/Holiday trips, zero Sunday revenue hours, and zero Sunday annual cost in downstream results. This is a silent wrong-number bug because the UI says the Sunday schedule exists, while the analysis modules treat it as empty.
**Trigger:** In a route or line Attributes popup, add Saturday bands, check “Mirror Saturday,” then run Route Costing or generate trips in Trip Builder.

### Weight averaged ACS values by overlap area, not coverage fraction
**Where:** `js/core/census.js:294`
**What:** `aggregateWithinUnion()` computes `frac = intersectionArea / geographyArea`, then for `aggMode === "avg"` returns `sum(value * frac) / sum(frac)`. That is fraction-weighting, not area-weighting: a fully-covered tiny block group and a fully-covered large tract both contribute weight `1`, regardless of their actual area.
**Why it matters:** Non-additive ACS outputs such as median household income, median age, median rent, and median home value can be biased toward small geographies. The output label says “Area-weighted average,” so users will treat the number as analytically meaningful when the weighting basis is wrong.
**Trigger:** Run Feature Area Analysis with any `avg` variable over a buffer that intersects geographies of materially different size or with different overlap proportions.

### Keep identical TPI raw values tied instead of rank-splitting them
**Where:** `js/projects/tpi-scoring.js:407`, `js/projects/tpi-scoring.js:439`
**What:** `computeQuintiles()` handles the all-equal case only when fewer than five values are present. With five or more valid geographies, it sorts by raw value and assigns quintiles by array index, so identical raw values are split across scores 1 through 5.
**Why it matters:** All-zero or tied factors create artificial hot and cold spots in TPI. Those false differences then feed composite TPI, route/factor scoring, and any downstream corridor scoring that consumes TPI-like outputs.
**Trigger:** Run TPI on a corridor with at least five geographies where one active factor has identical raw values across those geographies, such as all-zero employment, zero-car share, or another sparse factor.

### Stage imported session state before clearing live feature arrays
**Where:** `js/core/cache.js:126`, `js/core/cache.js:190`, `js/core/cache.js:374`
**What:** `validateState()` only verifies that top-level feature collections are arrays. `applyState()` then clears `App.points`, `App.lines`, `App.routes`, and `App.polygons` before rebuilding buffers and rendering layers from the imported objects; malformed GeoJSON or malformed feature properties can throw after the current session has already been replaced.
**Why it matters:** A bad session file can leave the app half-initialized and can destroy the user’s current in-memory work even though the file was not actually usable. The import catch block reports invalid JSON for any thrown error, which also hides the real failure mode from a non-coder maintainer.
**Trigger:** Load a JSON state file whose `points`, `lines`, `routes`, or `polygons` fields are arrays but contain malformed feature geometry, missing `properties`, invalid coordinates, or values that break buffer rebuild/render code.

## High

### Filter Census negative sentinel values consistently
**Where:** `js/core/census.js:146`, `js/core/census.js:191`, `js/projects/tpi-scoring.js:347`
**What:** The single-variable ACS fetch path, county ACS fetch path, and TPI batch fetch path accept any finite `Number(raw)`. Census ACS APIs can return negative sentinel values for unavailable estimates; `fetchACSMultiValues()` already filters negative placeholders, but the other ACS entry points do not.
**Why it matters:** Negative sentinel values can be treated as real population, income, denominator, or factor values. That can produce negative aggregates, inverted percentages, or distorted TPI quintiles without any visible error.
**Trigger:** Request an ACS variable/geography/year combination where the Census response contains a negative placeholder such as a suppressed, unavailable, or not-applicable estimate.

### Escape LODES file metadata before writing it with `innerHTML`
**Where:** `js/core/lodes.js:84`, `js/core/lodes.js:111`
**What:** `setLodesLoadedUI()` builds HTML by concatenating `f.stateAbbr`, `f.name`, and `f.nRows` into `infoEl.innerHTML`. `restoreLodesFromData()` accepts `meta.files` from a session JSON file and then calls the same UI renderer.
**Why it matters:** A crafted session file can inject HTML or script into the app origin through the LODES loaded-file list. This is an import-path XSS issue in exactly the untrusted JSON path the review prompt calls out.
**Trigger:** Import a state JSON where `lodesData.meta.files[0].name` contains HTML such as an image tag with an event handler.

### Escape GTFS ZIP entry names before rendering the file list
**Where:** `js/projects/gtfs.js:103`, `js/projects/gtfs.js:548`
**What:** `loadGTFSFile()` derives `name` from each ZIP path, and `renderFileList()` later writes that `fname` directly into `btn.innerHTML`. GTFS row values are escaped elsewhere, but the file name itself is not.
**Why it matters:** A malicious GTFS ZIP can execute HTML or script when the GTFS module lists feed files. Restored GTFS data has the same issue because `restoreGTFSFromData()` accepts object keys as file names.
**Trigger:** Load a GTFS ZIP with a `.txt` entry whose base name contains HTML, or import a state JSON with a malicious `gtfsData` key.

### Remove GTFS layer event handlers when replacing GTFS layers
**Where:** `js/projects/gtfs.js:219`, `js/projects/gtfs.js:276`, `js/projects/gtfs.js:376`
**What:** `addMapLayers()` calls `removeMapLayers()` and then `wireHoverEvents()`. `removeMapLayers()` removes MapLibre layers and sources, but it never unregisters the `mouseenter`, `mousemove`, `mouseleave`, `click`, or `contextmenu` handlers that `wireHoverEvents()` registers.
**Why it matters:** Loading or restoring GTFS feeds repeatedly accumulates duplicate event handlers. The observable result is duplicate hover/click behavior, repeated context actions, and retained closures over old GTFS state.
**Trigger:** Load a GTFS feed, clear it or load another one, then hover, click, or right-click the GTFS shapes/stops layer.

### Invalidate Trip Builder cached trips when index-based service keys change
**Where:** `js/projects/trip-builder.js:20`, `js/projects/trip-builder.js:106`, `js/projects/trip-builder.js:421`
**What:** Generated trips are stored in `_tripsByService` by keys such as `solo-route-0` and `solo-line-0`. Those keys are based on array index, not a stable feature identity, and `renderRightSide()` trusts stored trips whenever the current service has the same key.
**Why it matters:** After deletion, import, or reordering, another feature can inherit the same solo key and display/export trips generated for the previous feature. That produces a wrong schedule without any warning that the result is stale.
**Trigger:** Generate trips for a solo route, delete or reorder routes so another route occupies the same index, then reopen Trip Builder and select the reused solo service key.

### Surface localStorage save failures to the user
**Where:** `js/core/cache.js:252`
**What:** `save()` catches all localStorage failures and only logs `console.warn("Cache save failed:", e)`. The user gets no status message, no modal, and no disabled-save indication.
**Why it matters:** Quota or blocked-storage failures make the autosave contract false. A user can keep working for a long session, refresh the browser, and discover that recent work was never saved.
**Trigger:** Create a large session that exceeds localStorage quota, use a browser/profile that blocks localStorage, or hit an implementation-specific storage error during the debounced save.

## Medium

### Store GTFS copied route mode under the shared `mode` attribute
**Where:** `js/projects/gtfs.js:318`, `js/projects/gtfs.js:350`, `js/core/feature-attributes.js:29`, `js/projects/attribute-summary.js:9`
**What:** GTFS “Copy As Line” maps `route_type` to a `lineMode` attribute, but the shared route/line schema uses `attrs.mode`. Attribute Summary and the per-feature Attributes popup both read/write `mode`, so copied GTFS lines silently lose the imported mode in the normal editing UI.
**Why it matters:** This is cross-file schema drift: one import path writes a field that the rest of the route/line UI does not consume. A user who copies GTFS shapes as editable lines will not see the expected mode value and downstream modules that expect `mode` will not receive it.
**Trigger:** Load GTFS, right-click a shape, choose “Copy As Line,” then inspect the copied line in Attribute Summary or the per-feature Attributes popup.

### Bound imported Trip Builder headways before generating rows
**Where:** `js/projects/trip-builder.js:270`, `js/projects/trip-builder.js:303`, `js/core/cache.js:374`
**What:** The UI uses numeric inputs with a minimum of 1 minute, but imported JSON can set any positive `frequency`. `generateTripsForPattern()` loops from band start to end by `headway` with no lower bound and no maximum trip cap.
**Why it matters:** A malformed or malicious session can freeze the browser by generating millions of trip rows in the main thread. The app has no server-side recovery path, so this can make a project effectively unrecoverable until local state is cleared.
**Trigger:** Import a state file with a service band such as `from: "00:00"`, `to: "24:00"`, and `frequency: 0.000001`, then click Generate Trips.

### Preserve the undo contract for Attribute Summary edits
**Where:** `js/core/feature-attributes.js:74`, `js/projects/attribute-summary.js:17`
**What:** The per-feature attribute popup calls `App.undo.push()` before saving, but Attribute Summary edits call only `App.cache.save()` and `App.refreshFeaturePanel()`. The same attribute field is undoable in one UI and not undoable in the other.
**Why it matters:** Attribute Summary is a bulk-edit surface for service IDs, speeds, run times, names, colors, and notes. A mistaken edit there cannot be recovered through the same Undo controls users rely on elsewhere.
**Trigger:** Change `serviceId`, `avgSpeed`, `runTime`, or a feature name in Attribute Summary, then try Undo/Ctrl+Z.

### Validate required GTFS members before declaring a feed loaded
**Where:** `js/projects/gtfs.js:24`, `js/projects/gtfs.js:103`, `js/projects/gtfs.js:132`
**What:** The module defines a `REQUIRED` file map, but `loadGTFSFile()` accepts any ZIP containing at least one `.txt` file and then reports `GTFS loaded`. It does not require stops, routes, trips, stop_times, calendar, or calendar_dates before treating the feed as loaded.
**Why it matters:** A malformed ZIP can look successfully loaded while producing empty map layers and incomplete table views. The user gets no clear reason why the feed cannot be used as a real GTFS feed.
**Trigger:** Load a ZIP containing only `readme.txt`, only `shapes.txt`, or a partial set of GTFS files.

## Low / Notes

### Avoid baking the Census API key into public client source
**Where:** `js/core/utils.js:13`
**What:** `App.CENSUS_API_KEY` is a literal key in the browser-delivered JavaScript. This is not a private secret in a static client app, but it is still attributable quota that anyone can reuse from the source.
**Why it matters:** If the app is deployed publicly, third parties can burn the same key’s quota or cause Census API throttling for legitimate users.
**Trigger:** Open the deployed app source or repository and copy the key from `utils.js`.

## Architectural observations

- Add `App.buildTransitServices(options)` in a new `js/core/service-assembly.js` and move `collectPattern()`, `buildServicesFromFeatures()`, `validateService()`, `VALID_PAIR_KEYS`, `SOLO_OK_DIRECTIONS`, and runtime resolution into it. The immediate callers should be `js/projects/route-costing.js` and `js/projects/trip-builder.js`.
- Add `App.getEffectiveServiceBands(attrs, day)` in the same service helper so `sundayMirrorsSaturday` is resolved once. The callers should include Route Costing, Trip Builder, Attribute Summary band badges, and any future service-frequency module.
- Add a single escaping helper set in `js/core/utils.js`, such as `App.escapeHTML()` and `App.escapeAttr()`, and use it in `lodes.js`, `gtfs.js`, popup widgets, and any module that renders imported strings through `innerHTML`.
- Add `App.validateSessionState(state)` in `js/core/cache.js` or a new `js/core/session-schema.js` and run it before mutating `App.points`, `App.lines`, `App.routes`, or `App.polygons`. It should validate GeoJSON shape, coordinates, expected `properties`, feature-array sizes, and module payload types.
- Add stable feature IDs, for example `feature.properties.uid`, assigned when features are created and migrated during cache restore. Trip Builder service keys, point-route associations, and cached module result ownership should use those IDs instead of array indexes.
