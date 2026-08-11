// js/projects/transit-coverage.js
// Transit Coverage: registers as an analysis module, opens in a 2-column popup,
// computes ACS population + LODES jobs coverage within a buffer distance of
// selected transit routes/lines, clipped to a user-selected service area.
// Depends on: App namespace, App.popup (popup.js), App.cache (cache.js),
//   App.getEffectiveServiceBands (service-assembly.js), census.js, lodes.js, turf (CDN).
// Step 1: scaffolding + static Settings column.
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

  // ---- Coverage compute flow (stub — filled in by Step 5) ----

  async function runCoverage() {
    // Implemented in Step 5.
  }

  // ---- Popup lifecycle ----

  function init(core) {
    if (_initialized) return;
    _initialized = true;
    // Input wiring added in Step 2.
  }

  function onOpen(core) {
    // Checklist rebuild + result restore added in Step 2.
    App.renderModuleState({
      statusEl: "tcStatus", emptyEl: "tcEmptyState", empty: true, hint: emptyHint()
    });
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
    // Checklist rebuild + stale detection added in Step 2.
    if (!isPopupVisible()) return;
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
