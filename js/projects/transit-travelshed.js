// js/projects/transit-travelshed.js
// Transit Travelshed: registers as an analysis module, opens in a 2-column
// popup, and computes walk -> wait -> ride drawn transit routes/lines -> walk
// isochrones from a clicked map origin, with at most one transfer, rendered as
// 1-3 banded rings. Extends the offline road-network engine
// (js/core/road-network.js: computeWalkCostMap/polygonizeNodeSet/etc.) with
// the pure Travelshed calc engine (js/core/travelshed.js: window.Travelshed).
// Depends on: App.registerModule, App.popup, App.map, App.cache,
//   App.getEffectiveServiceBands (service-assembly.js), App.foldAnalysisUnion
//   (module-buffers.js), road-network.js exports, turf (CDN), maplibregl (CDN),
//   window.Travelshed (travelshed.js).
// No public API.

(function () {
  "use strict";
  var App = window.App = window.App || {};

  // ---- Defaults + module-local state (persists across popup open/close) ----

  var DEFAULT_SETTINGS = {
    budgets: [15, 30, null],
    walkSpeedMph: 3.1,
    dayType: "weekday",
    timeOfDay: "08:00",
    maxWaitMin: 10,
    boardPenaltyMin: 1,
    stopSpacingMi: 0.25,
    maxEdgeKm: 0.3
  };
  var KM_PER_MILE = 1.609344; // engine graph weights are in km; UI/attributes are in mph
  var TRANSFER_CAP = 1;

  var _settings     = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  var _origin        = null;   // [lng, lat] | null — probe pattern, not an App.points feature
  var _originMarker  = null;   // maplibregl.Marker | null
  var _lastResult    = null;
  var _stale         = false;
  var _running       = false;
  var _initialized   = false;

  // Per-stop walk-flood cache, keyed "stopKey|epoch|budgetKm.toFixed(3)" ->
  // { cost: {nodeKey: distKm}, access: [{nodeKey, extraKm} x2] } | null (null =
  // stop snapped >0.5km off-network). One flood per stop per (epoch, budget,
  // speed), ever — re-runs with only wait/time/band changes reuse every flood.
  // The epoch is embedded in the key, so a network re-download invalidates
  // naturally (stale entries just become unreferenced, never explicitly purged
  // — same convention as the Walkshed module's settingsKey cache).
  var _floodCache = new Map();

  // ---- DOM guard: only touch DOM when popup is open for this module ----

  function isPopupVisible() {
    return App.popup && App.popup.isOpen() && App.popup.currentModuleId() === "transit-travelshed";
  }

  // ---- Route/line checklist (annotates features with no schedule) ----

  function featureHasAnySchedule(feature) {
    var attrs = (feature.properties && feature.properties.attributes) || {};
    var svc = attrs.service || null;
    var days = ["weekday", "saturday", "sunday"];
    for (var i = 0; i < days.length; i++) {
      var bands = App.getEffectiveServiceBands ? App.getEffectiveServiceBands(svc, days[i]) : [];
      for (var j = 0; j < bands.length; j++) {
        var f = parseFloat(bands[j] && bands[j].frequency);
        if (Number.isFinite(f) && f > 0) return true;
      }
    }
    return false;
  }

  function buildRouteChecklist() {
    var el = document.getElementById("tsRouteList");
    if (!el) return;

    var prevState = {};
    var prev = el.querySelectorAll("input[type=checkbox]");
    for (var pi = 0; pi < prev.length; pi++) {
      prevState[prev[pi].getAttribute("data-type") + ":" + prev[pi].getAttribute("data-idx")] = prev[pi].checked;
    }

    el.innerHTML = "";
    var hasFeatures = false;

    function addRow(type, idx, feature, badge) {
      hasFeatures = true;
      var key = type + ":" + idx;
      var checked = (key in prevState) ? prevState[key] : true;
      var hasSchedule = featureHasAnySchedule(feature);

      var row = document.createElement("div");
      row.className = "rf-feature-check-row";

      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.setAttribute("data-type", type);
      cb.setAttribute("data-idx", String(idx));
      cb.checked = checked;

      var lbl = document.createElement("label");
      lbl.style.cssText = "flex:1;cursor:pointer;";
      lbl.textContent = ((feature.properties && feature.properties.name) || (type.charAt(0).toUpperCase() + type.slice(1) + " " + (idx + 1))) +
        (hasSchedule ? "" : " (no schedule)");
      if (!hasSchedule) lbl.style.color = "var(--muted)";

      var badgeEl = document.createElement("span");
      badgeEl.className = "rf-feature-type-badge";
      badgeEl.textContent = badge;

      lbl.addEventListener("click", function (e) { e.preventDefault(); cb.checked = !cb.checked; markStale(); });
      cb.addEventListener("change", markStale);

      row.appendChild(cb);
      row.appendChild(lbl);
      row.appendChild(badgeEl);
      el.appendChild(row);
    }

    var routes = App.routes || [];
    var lines  = App.lines  || [];
    for (var ri = 0; ri < routes.length; ri++) addRow("route", ri, routes[ri], "R");
    for (var li = 0; li < lines.length;  li++) addRow("line",  li, lines[li],  "L");

    if (!hasFeatures) {
      el.innerHTML = '<div style="padding:6px;color:var(--muted);font-size:12px;">No routes or lines drawn.</div>';
    }
  }

  function getSelectedRouteFilter() {
    var el = document.getElementById("tsRouteList");
    var routeIndices = [], lineIndices = [];
    if (!el) return { routeIndices: routeIndices, lineIndices: lineIndices };
    var boxes = el.querySelectorAll("input[type=checkbox]");
    for (var i = 0; i < boxes.length; i++) {
      var cb = boxes[i];
      if (!cb.checked) continue;
      var type = cb.getAttribute("data-type");
      var idx  = parseInt(cb.getAttribute("data-idx"), 10);
      if      (type === "route") routeIndices.push(idx);
      else if (type === "line")  lineIndices.push(idx);
    }
    return { routeIndices: routeIndices, lineIndices: lineIndices };
  }

  // ---- Small formatting / DOM helpers ----

  function minToHHMM(mins) {
    var t = ((Math.round(mins) % 1440) + 1440) % 1440;
    var h = Math.floor(t / 60);
    var m = t - h * 60;
    return h + ":" + (m < 10 ? "0" : "") + m;
  }

  function formatBandLabel(band) {
    return minToHHMM(band.fromMin) + "–" + minToHHMM(band.toMin) + " @ " + band.headwayMin + " min";
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function _dateStamp() {
    var d = new Date();
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function _triggerDownload(content, mimeType, filename) {
    var blob = new Blob([content], { type: mimeType });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  // ---- 6a. Stop resolution (turf-dependent, module-local) ----

  // Resolves each selected route/line into an engine-ready record. Bands select
  // the active headway at (dayType, analysisMin); a route with no active band is
  // marked excluded but still returned (disclosed in #tsRouteDetail, dropped
  // from compute by the caller). Real stops (Points whose associatedRoutes
  // references this feature) win over synthetic stops sampled at spacingMi.
  function resolveRoutes(selected, dayType, analysisMin, spacingMi) {
    var out = [];
    var routes = App.routes || [];
    var lines  = App.lines  || [];

    function processFeature(type, idx, feature) {
      if (!feature) return;
      var attrs = (feature.properties && feature.properties.attributes) || {};
      var name = (feature.properties && feature.properties.name) ||
        (type.charAt(0).toUpperCase() + type.slice(1) + " " + (idx + 1));
      var routeId = type + "-" + idx;

      var lengthMi = 0;
      try { lengthMi = turf.length(feature, { units: "miles" }); } catch (e) { lengthMi = 0; }

      var direction = attrs.direction || "Both";
      var mode = (direction === "Both") ? "both" : "forward";
      var runTimeMin = (attrs.runTime > 0) ? attrs.runTime : 0;
      var avgSpeedMph = attrs.avgSpeed || 14;

      // Loop/CW/CCW rides one-way in drawn order; if the geometry is also
      // closed (first/last coords within ~15 m), the ride wraps around the
      // full cycle instead of stopping at the drawn end (an open loop rides
      // linear — disclosed via `loop === null` in the route detail).
      var loop = null;
      if (direction === "Loop" || direction === "CW" || direction === "CCW") {
        var coords = feature.geometry && feature.geometry.coordinates;
        if (coords && coords.length >= 2) {
          var closeKm = Infinity;
          try { closeKm = turf.distance(turf.point(coords[0]), turf.point(coords[coords.length - 1]), { units: "kilometers" }); }
          catch (e) { closeKm = Infinity; }
          if (closeKm <= 0.015) {
            loop = { cycleMin: Travelshed.rideMinAtDistance(lengthMi, lengthMi, runTimeMin, avgSpeedMph) };
          }
        }
      }

      var bands = App.getEffectiveServiceBands ? App.getEffectiveServiceBands(attrs.service || null, dayType) : [];
      var band = Travelshed.selectActiveBand(bands, analysisMin);
      if (!band) {
        out.push({
          routeId: routeId, feature: feature, name: name, lengthMi: lengthMi,
          mode: mode, loop: loop, headwayMin: null, bandLabel: null,
          stopSource: null, stops: [], excluded: "no-service"
        });
        return;
      }

      // Real stops: Points whose attributes.associatedRoutes references this
      // feature by its draw-time counter (routeIdx/lineIdx), resolved by
      // SCANNING App.points (never the array index — indices shift on delete,
      // the counter doesn't; editing.js findRouteIndexByProp is the precedent).
      var idProp = (type === "route") ? "routeIdx" : "lineIdx";
      var featureId = feature.properties && feature.properties[idProp];
      var realStops = [];
      var points = App.points || [];
      for (var pi = 0; pi < points.length; pi++) {
        var pf = points[pi];
        if (!pf.properties || pf.properties.hidden) continue;
        var assoc = (pf.properties.attributes && pf.properties.attributes.associatedRoutes) || [];
        for (var ai = 0; ai < assoc.length; ai++) {
          var ref = assoc[ai];
          if (ref.featureType === type && ref.featureId === featureId) {
            var distAlongMi = 0;
            try { distAlongMi = turf.nearestPointOnLine(feature, pf, { units: "miles" }).properties.location; }
            catch (e) { distAlongMi = 0; }
            realStops.push({
              stopKey: pf.geometry.coordinates.join(","),
              coord: pf.geometry.coordinates.slice(),
              distAlongMi: distAlongMi
            });
            break; // one match per point is enough
          }
        }
      }

      var stopSource, rawStops;
      if (realStops.length) {
        realStops.sort(function (a, b) { return a.distAlongMi - b.distAlongMi; });
        stopSource = "real";
        rawStops = realStops;
      } else {
        stopSource = "sampled";
        rawStops = Travelshed.sampleStopPositions(lengthMi, spacingMi).map(function (d) {
          var coord;
          try { coord = turf.along(feature, d, { units: "miles" }).geometry.coordinates; }
          catch (e) { coord = feature.geometry.coordinates[0]; }
          return { stopKey: coord.join(","), coord: coord, distAlongMi: d };
        });
      }

      var stops = rawStops.map(function (s) {
        return {
          stopKey: s.stopKey,
          coord: s.coord,
          distAlongMi: s.distAlongMi,
          rideMin: Travelshed.rideMinAtDistance(s.distAlongMi, lengthMi, runTimeMin, avgSpeedMph)
        };
      });

      out.push({
        routeId: routeId, feature: feature, name: name, lengthMi: lengthMi,
        mode: mode, loop: loop, headwayMin: band.headwayMin, bandLabel: formatBandLabel(band),
        stopSource: stopSource, stops: stops, excluded: null
      });
    }

    (selected.routeIndices || []).forEach(function (idx) { processFeature("route", idx, routes[idx]); });
    (selected.lineIndices  || []).forEach(function (idx) { processFeature("line",  idx, lines[idx]);  });

    return out;
  }

  // ---- 6b. Snap + flood caches (chunked async) ----

  function floodCacheKey(stopKey, epoch, budgetKm) {
    return stopKey + "|" + epoch + "|" + budgetKm.toFixed(3);
  }

  // Fills _floodCache for every stop in stopsByKey not already cached at this
  // (epoch, budgetKm). Yields after EVERY stop flood so the UI stays responsive
  // and the status pill can count up (transit-propensity onProgress pattern).
  //
  // Flood budget decision: floods always run at the FULL max budget (the
  // caller passes budgetKm sized to the user's longest band) — an upper bound
  // on any remaining budget after a boarding, so one flood per stop serves
  // every boarding time, every band, and every re-run with unchanged
  // budget/speed. The pure engine thresholds a single flood into bands; we
  // never re-flood per remaining budget.
  async function ensureFloods(stopsByKey, budgetKm, onProgress) {
    var epoch = (typeof App.roadNetworkEpoch === "function") ? App.roadNetworkEpoch() : 0;
    var keys = Object.keys(stopsByKey);
    var cached = 0, fresh = 0;
    for (var i = 0; i < keys.length; i++) {
      var stopKey = keys[i];
      var cacheKey = floodCacheKey(stopKey, epoch, budgetKm);
      if (_floodCache.has(cacheKey)) { cached++; continue; }

      var coord = stopsByKey[stopKey].coord;
      var res = App.computeWalkCostMap ? App.computeWalkCostMap(coord, budgetKm) : null;
      if (!res) {
        _floodCache.set(cacheKey, null);
      } else {
        var costObj = {};
        res.distMap.forEach(function (d, k) { costObj[k] = d; });
        _floodCache.set(cacheKey, { cost: costObj, access: res.accessNodes });
      }
      fresh++;
      if (onProgress) onProgress(i + 1, keys.length);
      await new Promise(function (r) { setTimeout(r, 0); }); // yield after EVERY stop flood
    }
    return { cached: cached, fresh: fresh };
  }

  // ---- Status / stale / empty (standardized helper) ----

  function setStatus(msg, kind) {
    App.renderModuleState({
      statusEl: "tsStatus",
      emptyEl: "tsEmptyState",
      status: msg ? { kind: kind || "", message: msg } : null
    });
  }

  function emptyHint() {
    return { need: "Draw a route or line with service bands.", action: "Pick an origin and click Calculate." };
  }

  function showEmpty() {
    App.renderModuleState({ statusEl: "tsStatus", emptyEl: "tsEmptyState", empty: true, hint: emptyHint() });
  }

  function showStale() {
    _stale = true;
    App.renderModuleState({ statusEl: "tsStatus", emptyEl: "tsEmptyState", stale: true, onRerun: runTravelshed });
  }

  function markStale() {
    if (App.cache && App.cache.save) App.cache.save();
    if (!_lastResult) return;
    _stale = true;
    if (isPopupVisible()) { setExportEnabled(false); showStale(); }
  }

  function setExportEnabled(on) {
    var b = document.getElementById("tsExportBtn");
    if (b) b.disabled = !on;
  }

  // ---- Network availability ----
  // As of Phase 7, no-network no longer hard-disables Calculate — it routes
  // into the scoped prompt-to-download offer instead (see computeRequiredExtent
  // and the coverage check in runTravelshed). #tsNetWarn is purely informational.

  function refreshNetWarn() {
    var loaded = App.roadNetworkLoaded && App.roadNetworkLoaded();
    var warn = document.getElementById("tsNetWarn");
    if (warn) {
      warn.style.display = loaded ? "none" : "";
      if (!loaded) warn.textContent = "No street network loaded — Calculate will offer a scoped download. Or load one via Add Data.";
    }
  }

  // ---- 7. Prompt-to-download extent ----

  var _pendingDownloadExtent = null; // Feature<Polygon> | null — set by the last coverage check, consumed by #tsDownloadBtn

  // Rectangle covering everything the analysis could touch: the origin's
  // full-budget walk circle, unioned with a full-budget-walk buffer around
  // each selected route/line. Egress buffer = full-budget walk distance — any
  // egress walk is bounded by the total remaining budget at walk speed.
  // Coarse (ignores wait/ride time already spent) but safe: it only ever asks
  // for MORE coverage than strictly needed, never less.
  function computeRequiredExtent(originLngLat, selectedFeatures, maxBudgetMin, walkSpeedMph) {
    var maxWalkKm = walkSpeedMph * KM_PER_MILE * (maxBudgetMin / 60);
    var pieces = [turf.circle(originLngLat, maxWalkKm, { units: "kilometers", steps: 16 })];
    selectedFeatures.forEach(function (f) {
      var b = null;
      try { b = turf.buffer(f.feature, maxWalkKm, { units: "kilometers" }); } catch (e) { /* skip */ }
      if (b) pieces.push(b);
    });
    var union = App.foldAnalysisUnion(pieces);
    return union ? turf.bboxPolygon(turf.bbox(union)) : null;
  }

  function setCoverageWarn(msg) {
    var el = document.getElementById("tsCoverageWarn");
    if (!el) return;
    if (msg) { el.textContent = msg; el.style.display = ""; }
    else { el.style.display = "none"; }
  }

  function showDownloadBtn(show) {
    var btn = document.getElementById("tsDownloadBtn");
    if (btn) btn.style.display = show ? "" : "none";
  }

  // Downloads roads for the last computed required extent, then re-runs
  // automatically on success — the flood cache self-invalidates via the
  // network epoch embedded in its keys, so nothing needs manual clearing.
  async function downloadNetworkForPendingExtent() {
    if (!_pendingDownloadExtent || !App.fetchRoadNetworkForExtent) return;
    var btn = document.getElementById("tsDownloadBtn");
    if (btn) btn.disabled = true;
    try {
      var ok = await App.fetchRoadNetworkForExtent(_pendingDownloadExtent);
      if (ok) runTravelshed();
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ---- Settings <-> inputs ----

  function readSettingsFromInputs() {
    var b1 = document.getElementById("tsBudget1");
    var b2 = document.getElementById("tsBudget2");
    var b3 = document.getElementById("tsBudget3");
    var budgets = [b1, b2, b3].map(function (el) {
      if (!el || el.value === "") return null;
      var v = parseFloat(el.value);
      return (Number.isFinite(v) && v > 0) ? v : null;
    }).filter(function (v) { return v != null; });
    if (budgets.length) _settings.budgets = budgets;

    var speed = document.getElementById("tsWalkSpeed");
    if (speed && +speed.value > 0) _settings.walkSpeedMph = +speed.value;

    var day = document.getElementById("tsDayType");
    if (day) _settings.dayType = day.value;

    var time = document.getElementById("tsTimeOfDay");
    if (time && time.value) _settings.timeOfDay = time.value;

    var maxWait = document.getElementById("tsMaxWait");
    if (maxWait && +maxWait.value >= 0) _settings.maxWaitMin = +maxWait.value;

    var penalty = document.getElementById("tsBoardPenalty");
    if (penalty && +penalty.value >= 0) _settings.boardPenaltyMin = +penalty.value;

    var spacing = document.getElementById("tsStopSpacing");
    if (spacing && +spacing.value > 0) _settings.stopSpacingMi = +spacing.value;

    var maxEdge = document.getElementById("tsMaxEdge");
    if (maxEdge && +maxEdge.value > 0) _settings.maxEdgeKm = +maxEdge.value;

    if (App.cache && App.cache.save) App.cache.save();
  }

  function syncInputsFromSettings() {
    var budgets = _settings.budgets || [];
    var b1 = document.getElementById("tsBudget1");
    var b2 = document.getElementById("tsBudget2");
    var b3 = document.getElementById("tsBudget3");
    if (b1) b1.value = (budgets[0] != null) ? budgets[0] : "";
    if (b2) b2.value = (budgets[1] != null) ? budgets[1] : "";
    if (b3) b3.value = (budgets[2] != null) ? budgets[2] : "";

    var speed = document.getElementById("tsWalkSpeed");
    if (speed) speed.value = _settings.walkSpeedMph;

    var day = document.getElementById("tsDayType");
    if (day) day.value = _settings.dayType;

    var time = document.getElementById("tsTimeOfDay");
    if (time) time.value = _settings.timeOfDay;

    var maxWait = document.getElementById("tsMaxWait");
    if (maxWait) maxWait.value = _settings.maxWaitMin;

    var penalty = document.getElementById("tsBoardPenalty");
    if (penalty) penalty.value = _settings.boardPenaltyMin;

    var spacing = document.getElementById("tsStopSpacing");
    if (spacing) spacing.value = _settings.stopSpacingMi;

    var maxEdge = document.getElementById("tsMaxEdge");
    if (maxEdge) maxEdge.value = _settings.maxEdgeKm;

    var originLabel = document.getElementById("tsOriginLabel");
    if (originLabel) originLabel.textContent = _origin ? (_origin[1].toFixed(5) + ", " + _origin[0].toFixed(5)) : "Not set";
    var clearBtn = document.getElementById("tsClearOriginBtn");
    if (clearBtn) clearBtn.style.display = _origin ? "" : "none";
  }

  // ---- Origin picker (probe pattern — a clicked map point, NOT an App.points feature) ----

  // Arm the one-shot picker: close the popup so the map is clickable, set the
  // shared App.drawMode so editing/selection handlers (which already early-
  // return on any truthy drawMode) get out of the way, and show a crosshair.
  function armOriginPicker() {
    if (App.popup && App.popup.close) App.popup.close();
    App.drawMode = "ts-origin";
    if (App.map) App.map.getCanvas().style.cursor = "crosshair";
    App.setStatus("Click the map to set the travelshed origin (Esc to cancel)");
  }

  function disarmOriginPicker() {
    App.drawMode = null;
    if (App.map) App.map.getCanvas().style.cursor = "grab";
  }

  // Drop/update the single origin marker (measure.js's createLabel/createVertexDot
  // pattern — a plain maplibregl.Marker, .remove()'d on clear/replace).
  function setOrigin(lng, lat) {
    _origin = [lng, lat];
    if (_originMarker) _originMarker.remove();
    _originMarker = new maplibregl.Marker({ color: "#7c3aed" }).setLngLat(_origin).addTo(App.map);
    disarmOriginPicker();
    App.openModulePopup("transit-travelshed"); // reopen — its onOpen refreshes the origin label/clear button
    markStale();
    if (App.cache && App.cache.save) App.cache.save();
  }

  function clearOrigin() {
    if (_originMarker) { _originMarker.remove(); _originMarker = null; }
    _origin = null;
    syncInputsFromSettings(); // refresh the "Not set" label + hide the clear button
    markStale();
    if (App.cache && App.cache.save) App.cache.save();
  }

  // Map click handler + Escape-while-armed, registered ONCE (first popup open).
  // Both early-return unless this module's own drawMode value is active, so no
  // other file needs to change (editing/selection handlers already early-return
  // on any truthy App.drawMode — textboxes.js's _initDrawMode is the precedent).
  function initOriginPickerHandlers() {
    if (App.map) {
      App.map.on("click", function (e) {
        if (App.drawMode !== "ts-origin") return;
        setOrigin(e.lngLat.lng, e.lngLat.lat);
      });
    }
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (App.drawMode !== "ts-origin") return;
      disarmOriginPicker();
      App.setStatus("Ready");
      App.openModulePopup("transit-travelshed");
    });
  }

  // ---- 6d. Rendering ----

  var TS_SOURCE     = "ts-travelshed";
  var TS_FILL_LAYER = "ts-travelshed-fill";
  var TS_LINE_LAYER = "ts-travelshed-line";

  // 3-class Blues, innermost (band 0 = shortest budget) darkest — the repo's
  // only other `step`/classed color expression precedent is corridor-scoring.js.
  var TS_COLOR_EXPR = ["match", ["get", "band"], 0, "#1d4ed8", 1, "#3b82f6", 2, "#93c5fd", "#93c5fd"];

  function renderTravelshedLayers(rings) {
    var map = App.map;
    if (!map) return;
    var features = [];
    rings.forEach(function (r) {
      if (!r.ring) return;
      features.push({ type: "Feature", properties: { band: r.band, budgetMin: r.budgetMin }, geometry: r.ring.geometry });
    });
    var fc = { type: "FeatureCollection", features: features };

    if (!map.getSource(TS_SOURCE)) {
      map.addSource(TS_SOURCE, { type: "geojson", data: fc });
      map.addLayer({
        id: TS_FILL_LAYER, type: "fill", source: TS_SOURCE,
        paint: { "fill-color": TS_COLOR_EXPR, "fill-opacity": 0.35 }
      });
      map.addLayer({
        id: TS_LINE_LAYER, type: "line", source: TS_SOURCE,
        layout: { "line-join": "round" },
        paint: { "line-color": TS_COLOR_EXPR, "line-width": 1.5, "line-opacity": 0.9 }
      });
    } else {
      map.getSource(TS_SOURCE).setData(fc);
    }
  }

  function clearTravelshedLayers() {
    var map = App.map;
    if (!map) return;
    if (map.getLayer(TS_LINE_LAYER)) map.removeLayer(TS_LINE_LAYER);
    if (map.getLayer(TS_FILL_LAYER)) map.removeLayer(TS_FILL_LAYER);
    if (map.getSource(TS_SOURCE))    map.removeSource(TS_SOURCE);
  }

  // Widget options (position/width/title) only apply at creation, so this is
  // safe to call on every run — an already-shown widget just becomes visible
  // again and we re-fill its labels either way.
  async function showLegend(budgets) {
    if (!App.popup || !App.popup.showFloatingWidget) return;
    await App.popup.showFloatingWidget("ts-legend", "projects/transit-travelshed-legend.html", {
      position: "bottom-left", width: 200, title: "Transit Travelshed"
    });
    for (var i = 0; i < 3; i++) {
      var row = document.getElementById("tsLegendRow" + i);
      var label = document.getElementById("tsLegendLabel" + i);
      if (!row) continue;
      if (i < budgets.length) {
        row.style.display = "";
        if (label) label.textContent = "≤ " + budgets[i] + " min";
      } else {
        row.style.display = "none";
      }
    }
  }

  // ---- 6e. Results + route detail + export ----

  function renderResults(result) {
    var container   = document.getElementById("tsResultsTable");
    var resultsWrap = document.getElementById("tsResults");
    var emptyState  = document.getElementById("tsEmptyState");
    if (!container || !resultsWrap) return;
    if (emptyState) emptyState.style.display = "none";
    resultsWrap.style.display = "";

    var M2_TO_MI2 = 3.861021585e-7;
    var M2_TO_KM2 = 1e-6;

    var rows = "";
    result.bands.forEach(function (b) {
      var areaM2 = b.ring ? turf.area(b.ring) : 0;
      rows += "<tr><td>" + b.budgetMin + " min</td>" +
        "<td>" + (areaM2 * M2_TO_MI2).toFixed(3) + " mi&sup2;<span class='ws-sub'> / " +
          (areaM2 * M2_TO_KM2).toFixed(3) + " km&sup2;</span></td>" +
        "<td>" + b.nodeCount + "</td></tr>";
    });

    container.innerHTML =
      '<table class="ts-table"><thead><tr><th>Budget</th><th>Area</th><th>Nodes</th></tr></thead><tbody>' +
      rows + "</tbody></table>" +
      '<p class="tiny" style="margin-top:6px;color:var(--muted);">' +
        result.computeMs + " ms &middot; " + result.floodStats.fresh + " flood(s) computed, " +
        result.floodStats.cached + " reused" +
        (result.offNetworkStopCount ? " &middot; " + result.offNetworkStopCount + " stop(s) off-network (skipped)" : "") +
      "</p>";
  }

  function renderRouteDetail(resolved) {
    var el = document.getElementById("tsRouteDetail");
    if (!el) return;
    var html = '<div class="ts-route-detail">';
    resolved.forEach(function (r) {
      html += '<div class="ts-route-detail-row">';
      html += '<div class="ts-route-detail-name">' + escapeHtml(r.name) + '</div>';
      if (r.excluded === "no-service") {
        html += '<div class="ts-route-detail-sub ts-route-detail-excluded">Excluded — no service at ' +
          escapeHtml(_settings.timeOfDay) + " on " + escapeHtml(_settings.dayType) + '.</div>';
      } else {
        var wait = Travelshed.initialWait(r.headwayMin, _settings.maxWaitMin, _settings.boardPenaltyMin);
        var stopsLabel = (r.stopSource === "real")
          ? ("real (" + r.stops.length + ")")
          : ("sampled (" + r.stops.length + " @ " + _settings.stopSpacingMi + " mi)");
        var dirLabel = (r.mode === "both") ? "both directions" : (r.loop ? "loop (wraps around)" : "one-way, drawn order");
        html += '<div class="ts-route-detail-sub">' +
          "Band: " + escapeHtml(r.bandLabel) +
          " &middot; Wait: min(H/2, " + _settings.maxWaitMin + ") + " + _settings.boardPenaltyMin +
            " = " + wait.toFixed(1) + " min" +
          " &middot; Stops: " + stopsLabel +
          " &middot; Direction: " + dirLabel +
          (r.loop ? (" (cycle " + r.loop.cycleMin.toFixed(1) + " min)") : "") +
          "</div>";
      }
      html += "</div>";
    });
    html += "</div>";
    el.innerHTML = html;
  }

  function exportGeoJSON() {
    if (!_lastResult) return;
    var features = [];
    _lastResult.bands.forEach(function (b) {
      if (!b.ring) return;
      features.push({
        type: "Feature",
        properties: { band: b.band, budgetMin: b.budgetMin, areaM2: turf.area(b.ring), nodeCount: b.nodeCount },
        geometry: b.ring.geometry
      });
    });
    features.push({
      type: "Feature",
      properties: { kind: "origin" },
      geometry: { type: "Point", coordinates: _lastResult.origin }
    });

    var fc = {
      type: "FeatureCollection",
      metadata: {
        generator: "micro-analysis-tool transit-travelshed",
        generated: new Date().toISOString(),
        waitModel: "initial=min(headway/2," + _settings.maxWaitMin + ")+" + _settings.boardPenaltyMin +
          "; transfer=headway/2+" + _settings.boardPenaltyMin,
        budgets: _lastResult.budgets,
        dayType: _settings.dayType,
        timeOfDay: _settings.timeOfDay,
        stopSpacingMi: _settings.stopSpacingMi,
        networkEpoch: (typeof App.roadNetworkEpoch === "function") ? App.roadNetworkEpoch() : null
      },
      features: features
    };
    _triggerDownload(JSON.stringify(fc, null, 2), "application/geo+json", "transit-travelshed-" + _dateStamp() + ".geojson");
  }

  // ---- 6c. Orchestration ----

  async function runTravelshed() {
    if (_running) return;

    readSettingsFromInputs();

    if (!_origin) { setStatus("Pick an origin on the map first.", "error"); return; }

    var budgets = (_settings.budgets || []).filter(function (v) { return Number.isFinite(v) && v > 0; });
    budgets = Array.from(new Set(budgets)).sort(function (a, b) { return a - b; });
    if (!budgets.length) { setStatus("Enter at least one time budget.", "error"); return; }

    var filter = getSelectedRouteFilter();
    if (!filter.routeIndices.length && !filter.lineIndices.length) {
      setStatus("Select at least one route or line.", "error");
      return;
    }

    var maxBudgetMin = budgets[budgets.length - 1];

    // 2. Prompt-to-download extent check. Computed against the RAW selected
    // geometries (not resolveRoutes' band-filtered output) since it only needs
    // shapes, not schedules.
    var selectedFeatures = [];
    filter.routeIndices.forEach(function (idx) { if (App.routes[idx]) selectedFeatures.push({ feature: App.routes[idx] }); });
    filter.lineIndices.forEach(function (idx) { if (App.lines[idx]) selectedFeatures.push({ feature: App.lines[idx] }); });
    var requiredExtent = computeRequiredExtent(_origin, selectedFeatures, maxBudgetMin, _settings.walkSpeedMph);
    _pendingDownloadExtent = requiredExtent;

    var netLoaded = App.roadNetworkLoaded && App.roadNetworkLoaded();
    if (!netLoaded) {
      setCoverageWarn("No street network loaded.");
      showDownloadBtn(true);
      return;
    }
    var downloadedExtent = App.getRoadDownloadExtent ? App.getRoadDownloadExtent() : null;
    if (downloadedExtent === null) {
      // File-imported network — extent unknown. Soft warning; proceed anyway.
      setCoverageWarn("Imported network — can't verify it covers this analysis; results near the edge may be clipped.");
      showDownloadBtn(false);
    } else if (requiredExtent && !turf.booleanContains(downloadedExtent, requiredExtent)) {
      setCoverageWarn("Loaded streets don't cover this analysis area.");
      showDownloadBtn(true);
      return;
    } else {
      setCoverageWarn(null);
      showDownloadBtn(false);
    }

    var walkSpeedKmh = _settings.walkSpeedMph * KM_PER_MILE;
    var budgetKm = walkSpeedKmh * (maxBudgetMin / 60);

    var analysisMin = Travelshed.parseHHMMtoMin(_settings.timeOfDay);
    if (analysisMin == null) analysisMin = 480; // 08:00 fallback

    _running = true;
    var t0 = Date.now();
    var runBtn = document.getElementById("tsRunBtn");
    if (runBtn) runBtn.disabled = true;

    try {
      setStatus("Resolving routes…", "running");
      var resolved = resolveRoutes(filter, _settings.dayType, analysisMin, _settings.stopSpacingMi);
      var active = resolved.filter(function (r) { return !r.excluded; });

      if (!active.length) {
        setStatus("No selected route has service at " + _settings.timeOfDay + ".", "error");
        renderRouteDetail(resolved);
        return;
      }

      setStatus("Walking from origin…", "running");
      await new Promise(function (r) { setTimeout(r, 0); });
      var originFlood = App.computeWalkCostMap ? App.computeWalkCostMap(_origin, budgetKm) : null;
      if (!originFlood) {
        setStatus("Origin is more than 0.5 km from a loaded street.", "error");
        return;
      }
      var originCost = {};
      originFlood.distMap.forEach(function (d, k) { originCost[k] = d; });

      // Union of all stops across active routes, keyed by stopKey (a real stop
      // shared by two routes is only flooded once).
      var stopsByKey = {};
      active.forEach(function (r) {
        r.stops.forEach(function (s) { if (!stopsByKey[s.stopKey]) stopsByKey[s.stopKey] = s; });
      });

      var floodStats = await ensureFloods(stopsByKey, budgetKm, function (done, total) {
        setStatus("Walking from stop " + done + "/" + total + "…", "running");
      });

      // Assemble the pure-engine input from cached floods; stops that snapped
      // off-network (cached as null) are skipped and counted.
      var epoch = (typeof App.roadNetworkEpoch === "function") ? App.roadNetworkEpoch() : 0;
      var offNetworkStopCount = 0;
      var stopCosts = {};
      Object.keys(stopsByKey).forEach(function (k) {
        var entry = _floodCache.get(floodCacheKey(k, epoch, budgetKm));
        if (entry) stopCosts[k] = entry.cost;
      });

      var engineRoutes = [];
      active.forEach(function (r) {
        var stops = [];
        r.stops.forEach(function (s) {
          var entry = _floodCache.get(floodCacheKey(s.stopKey, epoch, budgetKm));
          if (!entry) { offNetworkStopCount++; return; }
          stops.push({ stopKey: s.stopKey, rideMin: s.rideMin, access: entry.access });
        });
        if (!stops.length) return; // every stop on this route was off-network
        engineRoutes.push({ routeId: r.routeId, mode: r.mode, loop: r.loop, headwayMin: r.headwayMin, stops: stops });
      });

      setStatus("Computing arrival times…", "running");
      await new Promise(function (r) { setTimeout(r, 0); });

      var engineResult = Travelshed.computeArrivalTimes({
        budgetMin: maxBudgetMin,
        walkSpeedKmh: walkSpeedKmh,
        maxInitialWaitMin: _settings.maxWaitMin,
        boardingPenaltyMin: _settings.boardPenaltyMin,
        transferCap: TRANSFER_CAP,
        originCost: originCost,
        routes: engineRoutes,
        stopCosts: stopCosts
      });

      var bandSets = Travelshed.bandNodeSets(engineResult.nodeTimes, budgets);

      setStatus("Building isochrones…", "running");
      await new Promise(function (r) { setTimeout(r, 0); });

      var polys = [];
      for (var bi = 0; bi < bandSets.length; bi++) {
        var bs = bandSets[bi];
        var coords = bs.nodeKeys.map(function (k) { return App.nodeKeyToCoord(k); });
        var poly = App.polygonizeNodeSet ? App.polygonizeNodeSet(coords, _settings.maxEdgeKm) : null;
        polys.push({ budgetMin: bs.budgetMin, polygon: poly, nodeCount: bs.nodeKeys.length });
        await new Promise(function (r) { setTimeout(r, 0); }); // yield between band polygonizations
      }

      // Ring differencing largest-first so the innermost band stays solid; a
      // turf.difference failure falls back to the un-differenced polygon for
      // that band rather than discarding the run.
      var rings = [];
      for (var ri = polys.length - 1; ri >= 0; ri--) {
        var band = polys[ri];
        var ringPoly = band.polygon;
        if (ringPoly && ri > 0 && polys[ri - 1].polygon) {
          try {
            var diffed = turf.difference(ringPoly, polys[ri - 1].polygon);
            if (diffed) ringPoly = diffed;
          } catch (e) { /* fall back to the un-differenced polygon for this band */ }
        }
        if (ringPoly) {
          ringPoly.properties = ringPoly.properties || {};
          ringPoly.properties.band = ri;
          ringPoly.properties.budgetMin = band.budgetMin;
        }
        rings.unshift({ band: ri, budgetMin: band.budgetMin, ring: ringPoly, nodeCount: band.nodeCount });
      }

      _lastResult = {
        origin: _origin.slice(),
        budgets: budgets,
        bands: rings,
        resolved: resolved,
        offNetworkStopCount: offNetworkStopCount,
        floodStats: floodStats,
        computeMs: Date.now() - t0
      };
      _stale = false;

      renderTravelshedLayers(rings);
      renderResults(_lastResult);
      renderRouteDetail(resolved);
      await showLegend(budgets);
      setExportEnabled(true);
      var renderedBands = rings.filter(function (r) { return r.ring; }).length;
      setStatus("Calculated travelshed — " + renderedBands + " band(s), " +
        engineResult.stats.nodesReached + " nodes reached.", "done");
    } finally {
      _running = false;
      if (runBtn) runBtn.disabled = false;
    }
  }

  // ---- Lifecycle ----

  function init(core) {
    if (_initialized) return;
    _initialized = true;

    syncInputsFromSettings();
    initOriginPickerHandlers();

    var pickBtn = document.getElementById("tsPickOriginBtn");
    if (pickBtn) pickBtn.addEventListener("click", armOriginPicker);

    var clearOriginBtn = document.getElementById("tsClearOriginBtn");
    if (clearOriginBtn) clearOriginBtn.addEventListener("click", clearOrigin);

    ["tsBudget1", "tsBudget2", "tsBudget3", "tsWalkSpeed", "tsDayType", "tsTimeOfDay",
     "tsMaxWait", "tsBoardPenalty", "tsStopSpacing", "tsMaxEdge"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener("change", function () { readSettingsFromInputs(); markStale(); });
    });

    var waitBtn = document.getElementById("tsWaitInfoBtn");
    var waitText = document.getElementById("tsWaitInfoText");
    if (waitBtn && waitText) {
      waitBtn.addEventListener("click", function () {
        waitText.style.display = (waitText.style.display === "none") ? "" : "none";
      });
    }

    var selectAll = document.getElementById("tsRouteSelectAll");
    if (selectAll) {
      selectAll.addEventListener("click", function (e) {
        e.preventDefault();
        document.querySelectorAll("#tsRouteList input[type=checkbox]").forEach(function (cb) { cb.checked = true; });
        markStale();
      });
    }
    var selectNone = document.getElementById("tsRouteSelectNone");
    if (selectNone) {
      selectNone.addEventListener("click", function (e) {
        e.preventDefault();
        document.querySelectorAll("#tsRouteList input[type=checkbox]").forEach(function (cb) { cb.checked = false; });
        markStale();
      });
    }

    var runBtn = document.getElementById("tsRunBtn");
    if (runBtn) runBtn.addEventListener("click", runTravelshed);

    var exportBtn = document.getElementById("tsExportBtn");
    if (exportBtn) exportBtn.addEventListener("click", exportGeoJSON);

    var downloadBtn = document.getElementById("tsDownloadBtn");
    if (downloadBtn) downloadBtn.addEventListener("click", downloadNetworkForPendingExtent);
  }

  function onOpen(core) {
    syncInputsFromSettings();
    buildRouteChecklist();
    refreshNetWarn();
    if (_lastResult) {
      renderResults(_lastResult);
      renderRouteDetail(_lastResult.resolved);
      setExportEnabled(!_stale);
      if (_stale) showStale(); else setStatus("", "");
    } else {
      setExportEnabled(false);
      showEmpty();
    }
  }

  function onClose(core) { /* state persists in closure */ }

  function clearAll() {
    clearTravelshedLayers();
    if (App.popup && App.popup.hideFloatingWidget) App.popup.hideFloatingWidget("ts-legend");
    _lastResult = null;
    _stale = false;
    if (isPopupVisible()) {
      var resultsEl = document.getElementById("tsResults");
      if (resultsEl) resultsEl.style.display = "none";
      setExportEnabled(false);
      showEmpty();
    }
  }

  async function update(core) {
    var noFeatures = (App.routes || []).length === 0 && (App.lines || []).length === 0;
    if (_lastResult && noFeatures) clearAll();
    if (!isPopupVisible()) return;
    buildRouteChecklist();
    refreshNetWarn();
    if (_lastResult) markStale();
  }

  // ---- Register ----

  App.registerModule({
    id:         "transit-travelshed",
    name:       "Transit Travelshed",
    enabled:    true,
    popupWidth: 900,
    popupHTML:  "projects/transit-travelshed-popup.html",

    init:    function (core) { init(core); },
    onOpen:  function (core) { onOpen(core); },
    onClose: function (core) { onClose(core); },
    clear:   function ()     { clearAll(); },
    update:  async function (core) { await update(core); }
  });

})();
