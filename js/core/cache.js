// js/core/cache.js
// Session cache: save/restore/reset via localStorage.
// Depends on: App.stations, App.lines, App.polygons (stations.js, lines.js, polygons.js),
//             App.rebuildBuffers, App.rebuildLineBuffers (stations.js, lines.js),
//             App.renderPolygonLayers (polygons.js), App.refreshFeaturePanel (features.js).
// Exports: App.cache

(function () {
  var App = window.App = window.App || {};

  var STORAGE_KEY = "mat-session";
  var SCHEMA_VERSION = 1;
  var _saveTimer = null;
  var DEBOUNCE_MS = 500;

  // ---- Collect current state into a serialisable object ----

  function collectState() {
    var state = {
      version: SCHEMA_VERSION,
      stations: App.stations.slice(),
      lines: App.lines.slice(),
      polygons: App.polygons.slice(),
      bufferRadius: parseFloat(document.getElementById("bufferRadius").value) || 0.5,
      lineBufferRadius: parseFloat(document.getElementById("lineBufferRadius").value) || 0.5,
      lodesFileName: App.lodesFileName || ""
    };

    // Checkbox selections
    var boxes = document.querySelectorAll('#varSelect input[type="checkbox"]');
    var checked = [];
    for (var i = 0; i < boxes.length; i++) {
      if (boxes[i].checked) checked.push(boxes[i].value);
    }
    state.checkedVars = checked;

    // Dropdowns
    var geoEl = document.getElementById("geoLevel");
    if (geoEl) state.geoLevel = geoEl.value;

    var yearEl = document.getElementById("yearSelect");
    if (yearEl) state.year = yearEl.value;

    return state;
  }

  // ---- Save (debounced) ----

  function save() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(function () {
      try {
        var json = JSON.stringify(collectState());
        localStorage.setItem(STORAGE_KEY, json);
      } catch (e) {
        console.warn("Cache save failed:", e);
      }
    }, DEBOUNCE_MS);
  }

  // ---- Restore ----
  // Returns true if cached data was found and applied.

  function restore() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;

      var state = JSON.parse(raw);
      if (!state || state.version !== SCHEMA_VERSION) {
        console.warn("Cache: schema version mismatch, ignoring cached data.");
        return false;
      }

      var hasData = false;

      // 1. Restore stations (mutate in-place to preserve closure reference)
      if (Array.isArray(state.stations) && state.stations.length > 0) {
        App.stations.length = 0;
        for (var i = 0; i < state.stations.length; i++) {
          App.stations.push(state.stations[i]);
        }
        hasData = true;
      }

      // 2. Restore lines (mutate in-place)
      if (Array.isArray(state.lines) && state.lines.length > 0) {
        App.lines.length = 0;
        for (var j = 0; j < state.lines.length; j++) {
          App.lines.push(state.lines[j]);
        }
        hasData = true;
      }

      // 3. Restore polygons (mutate in-place)
      if (Array.isArray(state.polygons) && state.polygons.length > 0) {
        App.polygons.length = 0;
        for (var k = 0; k < state.polygons.length; k++) {
          App.polygons.push(state.polygons[k]);
        }
        hasData = true;
      }

      // 4. Set buffer radius DOM inputs before rebuilding
      var bufRadEl = document.getElementById("bufferRadius");
      if (bufRadEl && state.bufferRadius != null) {
        bufRadEl.value = state.bufferRadius;
      }
      var lineBufRadEl = document.getElementById("lineBufferRadius");
      if (lineBufRadEl && state.lineBufferRadius != null) {
        lineBufRadEl.value = state.lineBufferRadius;
      }

      // 5. Rebuild derived buffers and re-render map layers
      var stationRadius = parseFloat(bufRadEl ? bufRadEl.value : "0.5") || 0.5;
      var lineRadius = parseFloat(lineBufRadEl ? lineBufRadEl.value : "0.5") || 0.5;
      App.rebuildBuffers(stationRadius);
      App.rebuildLineBuffers(lineRadius);
      App.renderPolygonLayers();

      // 6. Restore checkbox selections
      if (Array.isArray(state.checkedVars)) {
        var checkedSet = {};
        for (var ci = 0; ci < state.checkedVars.length; ci++) {
          checkedSet[state.checkedVars[ci]] = true;
        }
        var boxes = document.querySelectorAll('#varSelect input[type="checkbox"]');
        for (var bi = 0; bi < boxes.length; bi++) {
          boxes[bi].checked = !!checkedSet[boxes[bi].value];
        }
        if (state.checkedVars.length > 0) hasData = true;
      }

      // 7. Restore dropdown values
      var geoEl = document.getElementById("geoLevel");
      if (geoEl && state.geoLevel) geoEl.value = state.geoLevel;

      var yearEl = document.getElementById("yearSelect");
      if (yearEl && state.year) yearEl.value = state.year;

      // 8. LODES filename hint (data is NOT cached — too large)
      if (state.lodesFileName) {
        App.lodesFileName = state.lodesFileName;
        var lodesInfoEl = document.getElementById("lodesInfo");
        if (lodesInfoEl) {
          lodesInfoEl.textContent =
            "Previously loaded: " + state.lodesFileName + " \u2014 re-upload to use";
        }
      }

      return hasData;
    } catch (e) {
      console.warn("Cache restore failed:", e);
      return false;
    }
  }

  // ---- Reset: clear cache and all app state ----

  function reset() {
    // 1. Clear localStorage
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.warn("Cache clear failed:", e);
    }

    // 2. Clear all features
    App.clearStations();
    App.clearLines();
    App.clearPolygons();

    // 3. Reset buffer radii to defaults
    var bufRadEl = document.getElementById("bufferRadius");
    if (bufRadEl) bufRadEl.value = "0.5";
    var lineBufRadEl = document.getElementById("lineBufferRadius");
    if (lineBufRadEl) lineBufRadEl.value = "0.5";

    // 4. Clear LODES state
    App.lodesData = null;
    App.lodesFileName = "";
    if (typeof App.setLodesLoadedUI === "function") {
      App.setLodesLoadedUI(false, "", 0);
    }
    var lodesInfoEl = document.getElementById("lodesInfo");
    if (lodesInfoEl) lodesInfoEl.textContent = "";

    // 5. Uncheck all variable checkboxes
    var boxes = document.querySelectorAll('#varSelect input[type="checkbox"]');
    for (var i = 0; i < boxes.length; i++) boxes[i].checked = false;

    // 6. Reset dropdowns to defaults
    var geoEl = document.getElementById("geoLevel");
    if (geoEl) geoEl.value = "tract";
    var yearEl = document.getElementById("yearSelect");
    if (yearEl) yearEl.value = "2023";

    // 7. Hide summary status card
    var nGeosEl = document.getElementById("nGeos");
    if (nGeosEl) nGeosEl.textContent = "0";
    var statusCard = document.getElementById("summaryStatus");
    if (statusCard) statusCard.style.display = "none";

    // 8. Update status
    App.setStatus("Session reset");
  }

  // ---- Expose on App namespace ----

  App.cache = {
    save: save,
    restore: restore,
    reset: reset,
    STORAGE_KEY: STORAGE_KEY
  };
})();
