// js/core/cache.js
// Session cache: save/restore/reset via localStorage.
// JSON import/export via file download/upload.
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

  // ---- Apply a state object to the app (shared by restore + import) ----

  function applyState(state) {
    // 1. Clear all feature arrays unconditionally (in-place to preserve closure refs)
    App.stations.length = 0;
    App.lines.length = 0;
    App.polygons.length = 0;

    // 2. Push features
    if (Array.isArray(state.stations)) {
      for (var i = 0; i < state.stations.length; i++) App.stations.push(state.stations[i]);
    }
    if (Array.isArray(state.lines)) {
      for (var j = 0; j < state.lines.length; j++) App.lines.push(state.lines[j]);
    }
    if (Array.isArray(state.polygons)) {
      for (var k = 0; k < state.polygons.length; k++) App.polygons.push(state.polygons[k]);
    }

    // 3. Set buffer radius DOM inputs before rebuilding
    var bufRadEl = document.getElementById("bufferRadius");
    if (bufRadEl && state.bufferRadius != null) {
      bufRadEl.value = state.bufferRadius;
    }
    var lineBufRadEl = document.getElementById("lineBufferRadius");
    if (lineBufRadEl && state.lineBufferRadius != null) {
      lineBufRadEl.value = state.lineBufferRadius;
    }

    // 4. Rebuild derived buffers and re-render map layers
    var stationRadius = parseFloat(bufRadEl ? bufRadEl.value : "0.5") || 0.5;
    var lineRadius = parseFloat(lineBufRadEl ? lineBufRadEl.value : "0.5") || 0.5;
    App.rebuildBuffers(stationRadius);
    App.rebuildLineBuffers(lineRadius);
    App.renderPolygonLayers();

    // 5. Restore checkbox selections
    if (Array.isArray(state.checkedVars)) {
      var checkedSet = {};
      for (var ci = 0; ci < state.checkedVars.length; ci++) {
        checkedSet[state.checkedVars[ci]] = true;
      }
      var boxes = document.querySelectorAll('#varSelect input[type="checkbox"]');
      for (var bi = 0; bi < boxes.length; bi++) {
        boxes[bi].checked = !!checkedSet[boxes[bi].value];
      }
    }

    // 6. Restore dropdown values
    var geoEl = document.getElementById("geoLevel");
    if (geoEl && state.geoLevel) geoEl.value = state.geoLevel;

    var yearEl = document.getElementById("yearSelect");
    if (yearEl && state.year) yearEl.value = state.year;

    // 7. LODES filename hint (data is NOT cached — too large)
    if (state.lodesFileName) {
      App.lodesFileName = state.lodesFileName;
      var lodesInfoEl = document.getElementById("lodesInfo");
      if (lodesInfoEl) {
        lodesInfoEl.textContent =
          "Previously loaded: " + state.lodesFileName + " \u2014 re-upload to use";
      }
    }
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

      applyState(state);

      return (App.stations.length > 0 || App.lines.length > 0 ||
              App.polygons.length > 0);
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

  // ---- Validate imported state ----

  function validateState(state) {
    if (!state || typeof state !== "object") {
      return "File does not contain a valid JSON object.";
    }
    if (state.version !== SCHEMA_VERSION) {
      return "Unsupported file version (expected " + SCHEMA_VERSION +
             ", got " + (state.version || "none") + ").";
    }
    if (state.stations != null && !Array.isArray(state.stations)) {
      return "Invalid stations data.";
    }
    if (state.lines != null && !Array.isArray(state.lines)) {
      return "Invalid lines data.";
    }
    if (state.polygons != null && !Array.isArray(state.polygons)) {
      return "Invalid polygons data.";
    }
    return null; // null = valid
  }

  // ---- Export to JSON file ----

  function exportToFile() {
    try {
      var state = collectState();
      var json = JSON.stringify(state, null, 2);
      var blob = new Blob([json], { type: "application/json" });
      var url = URL.createObjectURL(blob);

      var now = new Date();
      var filename = "analysis-" + now.getFullYear() + "-" +
        String(now.getMonth() + 1).padStart(2, "0") + "-" +
        String(now.getDate()).padStart(2, "0") + ".json";

      var a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      App.setStatus("Exported " + filename);
    } catch (e) {
      console.warn("Export failed:", e);
      App.setStatus("Export failed: " + (e.message || e));
    }
  }

  // ---- Import from JSON file ----

  function importFromFile(file) {
    var reader = new FileReader();

    reader.onload = function (e) {
      try {
        var state = JSON.parse(e.target.result);
        var err = validateState(state);
        if (err) {
          App.setStatus("Import failed");
          alert("Import failed: " + err);
          return;
        }

        // Confirm if replacing existing features
        var hasExisting = (App.stations.length > 0 || App.lines.length > 0 ||
                           App.polygons.length > 0);
        if (hasExisting) {
          if (!confirm("Import will replace all current features and settings. Continue?")) {
            return;
          }
        }

        // Exit edit mode if active (handles would reference stale features)
        if (typeof App.exitEditMode === "function") App.exitEditMode();

        applyState(state);
        save(); // persist imported state to localStorage

        if (typeof App.notifyProject === "function") App.notifyProject();

        var nFeatures = App.stations.length + App.lines.length + App.polygons.length;
        App.setStatus("Imported " + nFeatures + " feature" + (nFeatures !== 1 ? "s" : ""));
      } catch (parseErr) {
        App.setStatus("Import failed");
        alert("Import failed: the file does not contain valid JSON.");
      }
    };

    reader.onerror = function () {
      App.setStatus("Import failed");
      alert("Import failed: could not read file.");
    };

    reader.readAsText(file);
  }

  // ---- Expose on App namespace ----

  App.cache = {
    save: save,
    restore: restore,
    reset: reset,
    exportToFile: exportToFile,
    importFromFile: importFromFile,
    STORAGE_KEY: STORAGE_KEY
  };
})();
