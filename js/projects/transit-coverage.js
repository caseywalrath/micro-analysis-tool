// js/projects/transit-coverage.js
// Transit Coverage: registers as an analysis module, opens in a 2-column popup,
// computes ACS population + LODES jobs coverage within a buffer distance of
// selected transit routes/lines, clipped to a user-selected service area.
// Depends on: App namespace, App.popup (popup.js), App.cache (cache.js),
//   App.getEffectiveServiceBands (service-assembly.js), census.js, lodes.js, turf (CDN).
// Step 2: checklists + input wiring + stale lifecycle.
// No public API.

(function () {
  "use strict";
  var App = window.App = window.App || {};

  // ---- Module-local state (persists across popup open/close) ----

  var _lastResult       = null;   // populated in Step 5: { geoLevel, year, ..., coverageClipped, thresholdClipped, serviceAreaUnion }
  var _stale            = false;
  var _running          = false;
  var _initialized       = false;
  var _apportionByArea   = false;
  var _savedSelections   = null;  // { routeIndices, lineIndices, polygonIndices } restored from session cache (Step 7)

  // ---- DOM guard: only touch DOM when popup is open for this module ----

  function isPopupVisible() {
    return App.popup && App.popup.isOpen() && App.popup.currentModuleId() === "transit-coverage";
  }

  // ---- Feature checklist (routes + lines) ----

  function buildFeatureChecklist() {
    var el = document.getElementById("tcFeatureList");
    if (!el) return;

    // Capture current check state before rebuilding
    var prevState = {};
    var prev = el.querySelectorAll("input[type=checkbox]");
    for (var pi = 0; pi < prev.length; pi++) {
      prevState[prev[pi].getAttribute("data-type") + ":" + prev[pi].getAttribute("data-idx")] = prev[pi].checked;
    }

    el.innerHTML = "";
    var hasFeatures = false;

    function addRow(type, idx, name, badge) {
      hasFeatures = true;
      var key = type + ":" + idx;
      var checked = (key in prevState) ? prevState[key] : true;
      var row = document.createElement("div");
      row.className = "rf-feature-check-row";

      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.setAttribute("data-type", type);
      cb.setAttribute("data-idx", String(idx));
      cb.checked = checked;

      var lbl = document.createElement("label");
      lbl.style.cssText = "flex:1;cursor:pointer;";
      lbl.textContent = name;

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

    for (var ri = 0; ri < routes.length; ri++) {
      addRow("route", ri,
        (routes[ri].properties && routes[ri].properties.name) || ("Route " + (ri + 1)),
        "R");
    }
    for (var li = 0; li < lines.length; li++) {
      addRow("line", li,
        (lines[li].properties && lines[li].properties.name) || ("Line " + (li + 1)),
        "L");
    }

    if (!hasFeatures) {
      el.innerHTML = '<div style="padding:6px;color:var(--muted);font-size:12px;">No routes or lines drawn.</div>';
    }
  }

  // ---- Service-area checklist (drawn polygons) ----

  function buildAreaChecklist() {
    var el = document.getElementById("tcAreaList");
    if (!el) return;

    var prevState = {};
    var prev = el.querySelectorAll("input[type=checkbox]");
    for (var pi = 0; pi < prev.length; pi++) {
      prevState[prev[pi].getAttribute("data-idx")] = prev[pi].checked;
    }

    el.innerHTML = "";
    var hasAreas = false;

    function addRow(idx, name) {
      hasAreas = true;
      var key = String(idx);
      var checked = (key in prevState) ? prevState[key] : true;
      var row = document.createElement("div");
      row.className = "rf-feature-check-row";

      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.setAttribute("data-type", "polygon");
      cb.setAttribute("data-idx", String(idx));
      cb.checked = checked;

      var lbl = document.createElement("label");
      lbl.style.cssText = "flex:1;cursor:pointer;";
      lbl.textContent = name;

      var badgeEl = document.createElement("span");
      badgeEl.className = "rf-feature-type-badge";
      badgeEl.textContent = "P";

      lbl.addEventListener("click", function (e) { e.preventDefault(); cb.checked = !cb.checked; markStale(); });
      cb.addEventListener("change", markStale);

      row.appendChild(cb);
      row.appendChild(lbl);
      row.appendChild(badgeEl);
      el.appendChild(row);
    }

    var polygons = App.polygons || [];
    for (var i = 0; i < polygons.length; i++) {
      addRow(i, (polygons[i].properties && polygons[i].properties.name) || ("Polygon " + (i + 1)));
    }

    if (!hasAreas) {
      el.innerHTML = '<div style="padding:6px;color:var(--muted);font-size:12px;">No polygons drawn.</div>';
    }
  }

  // ---- Selection readers/writers (explicit index arrays — never "null = all") ----

  function getSelectedFeatures() {
    var el = document.getElementById("tcFeatureList");
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

  function getSelectedAreas() {
    var el = document.getElementById("tcAreaList");
    var polygonIndices = [];
    if (!el) return { polygonIndices: polygonIndices };
    var boxes = el.querySelectorAll("input[type=checkbox]");
    for (var i = 0; i < boxes.length; i++) {
      var cb = boxes[i];
      if (!cb.checked) continue;
      polygonIndices.push(parseInt(cb.getAttribute("data-idx"), 10));
    }
    return { polygonIndices: polygonIndices };
  }

  function applySelections(sel) {
    if (!sel) return;
    var routeSet = new Set((sel.routeIndices   || []).map(Number));
    var lineSet  = new Set((sel.lineIndices    || []).map(Number));
    var polySet  = new Set((sel.polygonIndices || []).map(Number));

    var featEl = document.getElementById("tcFeatureList");
    if (featEl) {
      var featBoxes = featEl.querySelectorAll("input[type=checkbox]");
      for (var i = 0; i < featBoxes.length; i++) {
        var cb   = featBoxes[i];
        var type = cb.getAttribute("data-type");
        var idx  = parseInt(cb.getAttribute("data-idx"), 10);
        if (type === "route") cb.checked = routeSet.has(idx);
        if (type === "line")  cb.checked = lineSet.has(idx);
      }
    }

    var areaEl = document.getElementById("tcAreaList");
    if (areaEl) {
      var areaBoxes = areaEl.querySelectorAll("input[type=checkbox]");
      for (var j = 0; j < areaBoxes.length; j++) {
        var acb  = areaBoxes[j];
        var aidx = parseInt(acb.getAttribute("data-idx"), 10);
        acb.checked = polySet.has(aidx);
      }
    }
  }

  // ---- LODES warning icon visibility ----

  function updateLodesWarnings() {
    var warnBtn = document.getElementById("tcLodesWarnBtn");
    if (warnBtn) warnBtn.style.display = App.lodesData ? "none" : "";
  }

  // ---- Status + stale helpers ----

  function setStatus(msg, kind) {
    // kind: "" | "done" | "error" | "running" (stale is handled by markStale)
    App.renderModuleState({
      statusEl: "tcStatus",
      status: msg ? { kind: kind || "", message: msg } : null
    });
  }

  // Context-aware onboarding/empty hint shown when there are no results.
  function emptyHint() {
    var nFeat = (App.routes || []).length + (App.lines || []).length;
    if (!nFeat) {
      return { need: "Draw a route or line to begin.",
               action: "Use the Route or Line tool, then reopen this panel." };
    }
    var nArea = (App.polygons || []).length;
    if (!nArea) {
      return { need: "Draw a service-area polygon to begin.",
               action: "Use the Polygon tool to outline the area to measure coverage within." };
    }
    return { need: "Select transit features and a service area, then click Analyze Coverage.",
             action: "Coverage is measured as the share of the service area's population and jobs within the buffer distance." };
  }

  function setExportButtonsEnabled(enabled) {
    var csvBtn = document.getElementById("tcExportCSV");
    var gjBtn  = document.getElementById("tcExportGeoJSON");
    if (csvBtn) csvBtn.disabled = !enabled;
    if (gjBtn)  gjBtn.disabled  = !enabled;
  }

  function markStale() {
    _stale = true;
    setExportButtonsEnabled(false);
    if (!isPopupVisible()) return;
    if (_lastResult) {
      App.renderModuleState({ statusEl: "tcStatus", stale: true, onRerun: runCoverage });
    }
  }

  // ---- Pure helpers (no DOM/App state — testable via App._tcTest) ----

  function computePeakHeadway(service, dayType) {
    var bands = App.getEffectiveServiceBands ? App.getEffectiveServiceBands(service, dayType) : [];
    var min = null;
    for (var i = 0; i < bands.length; i++) {
      var f = parseFloat(bands[i] && bands[i].frequency);
      if (Number.isFinite(f) && f > 0) {
        if (min === null || f < min) min = f;
      }
    }
    return min;
  }

  function formatPct(num, den) {
    if (!Number.isFinite(den) || den <= 0 || !Number.isFinite(num)) return "—";
    return (100 * num / den).toFixed(1) + "%";
  }

  function formatCount(v) {
    if (!Number.isFinite(v)) return "—";
    return Math.round(v).toLocaleString();
  }

  function buildStatSentence(summary) {
    var s = summary || {};
    if (!Number.isFinite(s.popTotal) || s.popTotal <= 0) {
      return "No population found in the selected service area.";
    }
    var sentence = formatPct(s.popCovered, s.popTotal) +
      " of residents are within " + s.bufferMiles + " mi of selected transit";
    if (s.hasThreshold) {
      sentence += "; " + formatPct(s.popThreshold, s.popTotal) +
        " within " + s.bufferMiles + " mi of " + s.headwayThreshold + "-min-or-better service.";
    } else {
      sentence += ".";
    }
    return sentence;
  }

  function escapeHTML(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function _csvField(val) {
    if (val == null) return "";
    var s = String(val);
    if (s.indexOf(",") !== -1 || s.indexOf('"') !== -1 || s.indexOf("\n") !== -1) {
      s = '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function _dateStamp() {
    var d = new Date();
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  function _triggerDownload(content, mimeType, filename) {
    var blob = new Blob([content], { type: mimeType });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  // Test-only: expose the pure helpers to the golden harness
  // (test/run-golden.mjs). Guarded by __MAT_TEST__ so it has no effect in the
  // browser. See test/README.md.
  if (typeof window !== "undefined" && window.__MAT_TEST__) {
    App._tcTest = {
      computePeakHeadway: computePeakHeadway,
      formatPct:          formatPct,
      formatCount:        formatCount,
      buildStatSentence:  buildStatSentence,
      _csvField:          _csvField
    };
  }

  // ---- Coverage compute flow (stub — filled in by Step 5) ----

  async function runCoverage() {
    // Implemented in Step 5.
  }

  // ---- Results rendering (stub — filled in by Step 6) ----

  function renderResults(result) {
    // Implemented in Step 6.
  }

  // ---- Exports (stubs — filled in by Step 6) ----

  function exportCSV() {
    // Implemented in Step 6.
  }

  function exportGeoJSON() {
    // Implemented in Step 6.
  }

  // ---- Popup lifecycle ----

  function init(core) {
    if (_initialized) return;
    _initialized = true;

    // Geography level / ACS year
    var geoLevel = document.getElementById("tcGeoLevel");
    if (geoLevel) geoLevel.addEventListener("change", markStale);

    var yearSel = document.getElementById("tcYearSelect");
    if (yearSel) yearSel.addEventListener("change", markStale);

    // Coverage settings
    var bufferInput = document.getElementById("tcBufferMiles");
    if (bufferInput) bufferInput.addEventListener("change", markStale);

    var dayTypeSel = document.getElementById("tcDayType");
    if (dayTypeSel) dayTypeSel.addEventListener("change", markStale);

    var thresholdInput = document.getElementById("tcHeadwayThreshold");
    if (thresholdInput) thresholdInput.addEventListener("change", markStale);

    // Apportion-by-area checkbox
    var apportionCb = document.getElementById("tcApportionByArea");
    if (apportionCb) {
      apportionCb.checked = _apportionByArea;
      apportionCb.addEventListener("change", function () {
        _apportionByArea = apportionCb.checked;
        markStale();
      });
    }

    // Transit features select all / clear
    var featSelectAll = document.getElementById("tcFeatSelectAll");
    if (featSelectAll) {
      featSelectAll.addEventListener("click", function (e) {
        e.preventDefault();
        document.querySelectorAll("#tcFeatureList input[type=checkbox]").forEach(function (cb) { cb.checked = true; });
        markStale();
      });
    }
    var featSelectNone = document.getElementById("tcFeatSelectNone");
    if (featSelectNone) {
      featSelectNone.addEventListener("click", function (e) {
        e.preventDefault();
        document.querySelectorAll("#tcFeatureList input[type=checkbox]").forEach(function (cb) { cb.checked = false; });
        markStale();
      });
    }

    // Service-area select all / clear
    var areaSelectAll = document.getElementById("tcAreaSelectAll");
    if (areaSelectAll) {
      areaSelectAll.addEventListener("click", function (e) {
        e.preventDefault();
        document.querySelectorAll("#tcAreaList input[type=checkbox]").forEach(function (cb) { cb.checked = true; });
        markStale();
      });
    }
    var areaSelectNone = document.getElementById("tcAreaSelectNone");
    if (areaSelectNone) {
      areaSelectNone.addEventListener("click", function (e) {
        e.preventDefault();
        document.querySelectorAll("#tcAreaList input[type=checkbox]").forEach(function (cb) { cb.checked = false; });
        markStale();
      });
    }

    // Analyze Coverage
    var runBtn = document.getElementById("tcRunBtn");
    if (runBtn) runBtn.addEventListener("click", runCoverage);

    // Exports
    var csvBtn = document.getElementById("tcExportCSV");
    if (csvBtn) csvBtn.addEventListener("click", exportCSV);
    var gjBtn = document.getElementById("tcExportGeoJSON");
    if (gjBtn) gjBtn.addEventListener("click", exportGeoJSON);
  }

  function onOpen(core) {
    buildFeatureChecklist();
    buildAreaChecklist();
    if (_savedSelections) applySelections(_savedSelections);
    updateLodesWarnings();

    var apportionCb = document.getElementById("tcApportionByArea");
    if (apportionCb) apportionCb.checked = _apportionByArea;

    if (_lastResult) {
      renderResults(_lastResult);
      setExportButtonsEnabled(!_stale);
    } else {
      setExportButtonsEnabled(false);
      App.renderModuleState({
        statusEl: "tcStatus", emptyEl: "tcEmptyState", empty: true, hint: emptyHint()
      });
    }
    if (_stale) markStale();
  }

  function onClose(core) {
    // State persists in closure.
  }

  function clearAll() {
    // Map overlay/legend teardown added in Step 5-6.
    _lastResult = null;
    _stale = false;
    if (isPopupVisible()) {
      var resultsEl = document.getElementById("tcResults");
      if (resultsEl) resultsEl.style.display = "none";
      App.renderModuleState({
        statusEl: "tcStatus", emptyEl: "tcEmptyState", empty: true, hint: emptyHint()
      });
      setExportButtonsEnabled(false);
    }
  }

  async function update(core) {
    var noFeatures = (App.routes || []).length === 0 && (App.lines || []).length === 0;
    var noAreas    = (App.polygons || []).length === 0;
    if (_lastResult && (noFeatures || noAreas)) {
      clearAll();
    }
    if (!isPopupVisible()) return;
    buildFeatureChecklist();
    buildAreaChecklist();
    updateLodesWarnings();
    if (_lastResult) markStale();
  }

  // ---- Register as analysis module ----

  App.registerModule({
    id:         "transit-coverage",
    name:       "Transit Coverage",
    enabled:    true,
    popupWidth: 960,
    popupHTML:  "projects/transit-coverage-popup.html",

    init:    function (core) { init(core); },
    onOpen:  function (core) { onOpen(core); },
    onClose: function (core) { onClose(core); },
    clear:   function ()     { clearAll(); },
    update:  async function (core) { await update(core); }
  });

})();
