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

  // ---- Network availability (walkshed-style hard disable; Phase 7 relaxes this) ----

  function refreshNetWarn() {
    var loaded = App.roadNetworkLoaded && App.roadNetworkLoaded();
    var warn = document.getElementById("tsNetWarn");
    if (warn) warn.style.display = loaded ? "none" : "";
    var btn = document.getElementById("tsRunBtn");
    if (btn) btn.disabled = !loaded;
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

  // ---- Run (stub — implemented in Phase 6: compute pipeline + rendering) ----

  function runTravelshed() {
    setStatus("Transit Travelshed compute is not implemented yet.", "error");
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
  }

  function onOpen(core) {
    syncInputsFromSettings();
    buildRouteChecklist();
    refreshNetWarn();
    if (_lastResult) {
      setExportEnabled(!_stale);
      if (_stale) showStale(); else setStatus("", "");
    } else {
      setExportEnabled(false);
      showEmpty();
    }
  }

  function onClose(core) { /* state persists in closure */ }

  function clearAll() {
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
    if (!isPopupVisible()) return;
    buildRouteChecklist();
    refreshNetWarn();
    markStale();
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
