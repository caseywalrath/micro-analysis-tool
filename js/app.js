// js/app.js
// Startup: wires core modules together, loads active project panel,
// contains summary runners and core event bindings.
// Depends on: all core modules (utils, map, stations, census, lodes).
// Exports: registerProject

(function () {
  var App = window.App;

  // ---- Draw mode ----

  App.drawMode = null; // null | "station" | "line" | "route" | "polygon"

  // ---- Data Inputs panel ----

  // Reusable ⚠ tooltip markup for median (non-additive) variables.
  var WARN_ICON = '<span class="var-warn-icon" title="Median estimate \u2014 displayed as an area-weighted average of overlapping geographies\u2019 values. This is not a true median for the buffer area. Use with caution.">\u26A0</span>';

  var DATA_INPUTS_PANEL_HTML =
    // ---- Census section ----
    '<div class="sb2-section-label">Census</div>' +

    '<div class="var-actions">' +
      '<button type="button" id="varSelectAll" class="var-action-btn">Select all</button>' +
      '<button type="button" id="varClearAll" class="var-action-btn">Clear all</button>' +
    '</div>' +

    '<fieldset id="varSelect" class="var-checklist">' +
      '<legend>Variables (select one or more)</legend>' +

      // ---- Demographics ----
      '<div class="var-group-label">Demographics</div>' +
      '<label class="var-check"><input type="checkbox" value="B01003_001E"> Total population</label>' +
      '<label class="var-check"><input type="checkbox" value="B11001_001E"> Total households</label>' +
      '<label class="var-check"><input type="checkbox" value="DERIVED_PPH"> Average persons per household</label>' +
      '<label class="var-check"><input type="checkbox" value="B19013_001E"> Median household income ' + WARN_ICON + '</label>' +
      '<label class="var-check"><input type="checkbox" value="B01002_001E"> Median age ' + WARN_ICON + '</label>' +
      '<label class="var-check"><input type="checkbox" value="GROUP_SEX"> Sex</label>' +
      '<label class="var-check"><input type="checkbox" value="GROUP_RACE"> Race</label>' +
      '<label class="var-check"><input type="checkbox" value="GROUP_ETHNICITY"> Ethnicity</label>' +

      // ---- Equity ----
      '<div class="var-group-label">Equity</div>' +
      '<label class="var-check"><input type="checkbox" value="DERIVED_DISABILITY"> With a disability</label>' +
      '<label class="var-check"><input type="checkbox" value="B17001_002E"> Persons below poverty level</label>' +
      '<label class="var-check"><input type="checkbox" value="GROUP_EDUCATION"> Education</label>' +
      '<label class="var-check"><input type="checkbox" value="DERIVED_LEP"> Limited English proficient</label>' +
      '<label class="var-check"><input type="checkbox" value="GROUP_CITIZENSHIP"> Citizenship</label>' +
      '<label class="var-check"><input type="checkbox" value="B08201_002E"> Zero-car households</label>' +
      '<label class="var-check"><input type="checkbox" value="GROUP_EMPLOYMENT"> Employment status</label>' +

      // ---- Travel ----
      '<div class="var-group-label">Travel</div>' +
      '<label class="var-check"><input type="checkbox" value="GROUP_COMMUTE"> Commute mode</label>' +
      '<label class="var-check"><input type="checkbox" value="GROUP_COMMTIME"> Commute time</label>' +

      // ---- Housing ----
      '<div class="var-group-label">Housing</div>' +
      '<label class="var-check"><input type="checkbox" value="B25001_001E"> Total housing units</label>' +
      '<label class="var-check"><input type="checkbox" value="GROUP_OCCUPANCY"> Occupancy</label>' +
      '<label class="var-check"><input type="checkbox" value="GROUP_RENT_BURDEN"> Rent burden</label>' +
      '<label class="var-check"><input type="checkbox" value="B25064_001E"> Median gross rent ' + WARN_ICON + '</label>' +
      '<label class="var-check"><input type="checkbox" value="B25077_001E"> Median home value ' + WARN_ICON + '</label>' +

    '</fieldset>' +

    // ---- Employment (LODES) section ----
    '<div class="sb2-section-label">Employment (LODES)</div>' +
    '<label class="var-check"><input type="checkbox" id="lodesCheckbox" value="LODES_WAC_C000"> Total existing employment \u2014 file required</label>' +
    '<div class="lodes-actions">' +
      '<button type="button" id="downloadLodes">Download</button>' +
      '<button type="button" id="lodesOpenFile">Add State</button>' +
      '<button type="button" id="lodesClearAll" style="display:none;">Clear All</button>' +
    '</div>' +
    '<input id="lodesFile" type="file" accept=".gz,.csv.gz" style="display:none" />' +
    '<div id="lodesInfo" class="sb2-tiny" style="margin-top:4px;"></div>' +
    '<span id="lodesState" style="display:none"></span>' +
    '<span id="lodesLoaded" style="display:none"></span>' +

    // PPACG Pop Projection has moved to the Projections tab in Ridership Forecasting.
    '';

  // ---- Module registry (replaces single-project system) ----

  var _modules = new Map(); // Map<id, moduleConfig>

  App.registerModule = function (config) {
    _modules.set(config.id, config);
  };

  // Backward-compat alias so existing project files still work during migration
  App.registerProject = App.registerModule;

  // Override bufferUnionPolygon to include line and route buffers alongside station buffers.
  // Must happen before any user interaction; census.js and lodes.js call this at runtime.
  var _stationUnion = App.bufferUnionPolygon;
  App.bufferUnionPolygon = function () {
    var su = _stationUnion();
    var lu = App.lineBufferUnionPolygon ? App.lineBufferUnionPolygon() : null;
    var ru = App.routeBufferUnionPolygon ? App.routeBufferUnionPolygon() : null;
    var pu = App.polygonUnionPolygon ? App.polygonUnionPolygon() : null;
    var combined = su || null;
    if (lu) combined = combined ? turf.union(combined, lu) : lu;
    if (ru) combined = combined ? turf.union(combined, ru) : ru;
    if (pu) combined = combined ? turf.union(combined, pu) : pu;
    return combined;
  };

  // Build a core API object for passing to project hooks.
  // Rebuilt each call so values like lodesData are always current.
  function buildCore() {
    return {
      stations: App.stations,
      buffers: App.buffers,
      routes: App.routes,
      routeBuffers: App.routeBuffers,
      map: App.map,
      lodesData: App.lodesData,
      lodesFileName: App.lodesFileName,
      getUnion: function () { return App.bufferUnionPolygon(); },
      fetchTigerwebGeos: App.fetchTigerwebGeos,
      fetchACSValues: App.fetchACSValues,
      fetchACSCountyValues: App.fetchACSCountyValues,
      aggregateWithinUnion: App.aggregateWithinUnion,
      computeAcsValueOnly: App.computeAcsValueOnly,
      computeEmploymentServedOnly: App.computeEmploymentServedOnly,
      fetchBlocksInternalPointsInUnion: App.fetchBlocksInternalPointsInUnion,
      utils: {
        setStatus: App.setStatus,
        parseCSV: App.parseCSV,
        toNumberSafe: App.toNumberSafe,
        normalizeTractGEOID: App.normalizeTractGEOID,
        guessHeader: App.guessHeader,
        fillSelect: App.fillSelect,
        enableSelect: App.enableSelect,
        formatValue: App.formatValue,
        getMeta: App.getMeta,
        setAggUI: App.setAggUI
      }
    };
  }

  // Notify all registered modules that data has changed.
  // Called sequentially to avoid overwhelming Census API.
  async function notifyProject() {
    var core = buildCore();
    for (var entry of _modules.values()) {
      if (typeof entry.update === "function") {
        await entry.update(core);
      }
    }
  }
  App.notifyProject = notifyProject;

  // Clear all module state (choropleths, legends, results).
  // Called by Clear and Reset Session buttons.
  function clearModules() {
    for (var entry of _modules.values()) {
      if (typeof entry.clear === "function") {
        entry.clear();
      }
    }
  }

  // Note: runSummary() and helpers (CHECKBOX_GROUPS, MANDATORY_VARS, DENOM_MAP,
  // expandGroups, aggDescription) have moved to js/projects/buffer-summary.js.

  // ---- Build Analysis sidebar panel HTML ----

  function buildAnalysisButtonsHTML() {
    var html = '<div class="analysis-module-list">';
    for (var entry of _modules.values()) {
      var isEnabled = entry.enabled !== false;
      var disabledAttr = isEnabled ? '' : ' disabled';
      html += '<button class="analysis-module-btn"' +
              ' data-module-id="' + entry.id + '"' + disabledAttr + '>' +
              (entry.name || entry.id) +
              (isEnabled ? '' : ' <span class="coming-soon">(coming soon)</span>') +
              '</button>';
    }
    html += '</div>';
    return html;
  }

  // ---- Feature delete hook (called by features.js) ----

  App.onFeatureDelete = function () {
    if (typeof App.exitEditMode === "function") App.exitEditMode();
    if (typeof App.clearSelection === "function") App.clearSelection();
    if (typeof App.refreshFeaturePanel === "function") App.refreshFeaturePanel();
    notifyProject();
    if (typeof App.cache !== "undefined") App.cache.save();
  };

  // ---- Map load: wire everything ----

  App.map.on("load", async function () {
    App.setStatus("Ready");
    App.renderStationLayers();
    App.renderLineLayers();
    App.renderRouteLayers();
    App.renderPolygonLayers();

    // Initialize feature editing (station drag, vertex editing)
    if (typeof App._initEditing === "function") App._initEditing();

    // Initialize hover/selection highlight layers
    if (typeof App.initHighlightLayers === "function") App.initHighlightLayers();

    // ---- Register sidebar panels, render, then wire events ----
    App.sidebar.addPanel({
      id: "station-data",
      title: "Data Inputs",
      html: DATA_INPUTS_PANEL_HTML,
      collapsed: false,
      order: 10
    });
    if (_modules.size > 0) {
      App.sidebar.addPanel({
        id: "analysis",
        title: "Analysis",
        html: buildAnalysisButtonsHTML(),
        collapsed: false,
        order: 30
      });
    }
    App.sidebar.render();

    // Wire popup system and analysis module buttons
    App.popup.wire(_modules, buildCore);

    var moduleButtons = document.querySelectorAll(".analysis-module-btn");
    moduleButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var moduleId = btn.getAttribute("data-module-id");
        if (moduleId) App.popup.open(moduleId, _modules, buildCore);
      });
    });

    // ---- Toolbar: draw mode buttons ----
    var toolBtns = document.querySelectorAll(".tool-btn");
    toolBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var prevMode = App.drawMode;
        var clickedMode = btn.getAttribute("data-mode");

        // Toggle: clicking the active button deselects it
        if (App.drawMode === clickedMode) {
          App.drawMode = null;
          btn.classList.remove("active");
        } else {
          App.drawMode = clickedMode;
          toolBtns.forEach(function (b) { b.classList.remove("active"); });
          btn.classList.add("active");
        }

        // Cancel in-progress drawing when leaving a draw mode
        if (prevMode === "line" && App.drawMode !== "line") {
          App.cancelLineDrawing();
        }
        if (prevMode === "route" && App.drawMode !== "route") {
          App.cancelRouteDrawing();
        }
        if (prevMode === "polygon" && App.drawMode !== "polygon") {
          App.cancelPolygonDrawing();
        }

        // Clear any lingering preview coordinates
        if (typeof App.setLinePreview === "function") App.setLinePreview(null);
        if (typeof App.setRoutePreview === "function") App.setRoutePreview(null);
        if (typeof App.setPolygonPreview === "function") App.setPolygonPreview(null);

        // Clear feature selection when entering a draw mode
        if (App.drawMode && typeof App.clearSelection === "function") App.clearSelection();

        // Update cursor for draw mode
        if (App.drawMode) {
          App.map.getCanvas().style.cursor = "crosshair";
        } else {
          App.map.getCanvas().style.cursor = "grab";
        }

        App.setStatus(App.drawMode
          ? App.drawMode.charAt(0).toUpperCase() + App.drawMode.slice(1) + " mode"
          : "Ready");
      });
    });

    // Exit draw mode (called by save functions after completing a line/route/polygon)
    App.exitDrawMode = function () {
      App.drawMode = null;
      document.querySelectorAll(".tool-btn").forEach(function (b) {
        b.classList.remove("active");
      });
      App.map.getCanvas().style.cursor = "grab";
    };

    // Variable checkbox list: select all / clear all
    document.getElementById("varSelectAll").addEventListener("click", function () {
      var boxes = document.querySelectorAll('#varSelect input[type="checkbox"]');
      for (var i = 0; i < boxes.length; i++) boxes[i].checked = true;
      var lodesCb = document.getElementById("lodesCheckbox");
      if (lodesCb) lodesCb.checked = true;
      if (typeof App.cache !== "undefined") App.cache.save();
    });
    document.getElementById("varClearAll").addEventListener("click", function () {
      var boxes = document.querySelectorAll('#varSelect input[type="checkbox"]');
      for (var i = 0; i < boxes.length; i++) boxes[i].checked = false;
      var lodesCb = document.getElementById("lodesCheckbox");
      if (lodesCb) lodesCb.checked = false;
      if (typeof App.cache !== "undefined") App.cache.save();
    });

    // Keyboard shortcuts
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && App.popup.isOpen()) {
        App.popup.close();
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        var tag = e.target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable) return;
        var ed = App._editing;
        if (ed && ed.type === "vertex-edit") {
          var ft = ed.featureType, fi = ed.featureIndex;
          App.exitEditMode();
          if (ft === "line")         App.removeLine(fi);
          else if (ft === "route")   App.removeRoute(fi);
          else if (ft === "polygon") App.removePolygon(fi);
          if (typeof App.onFeatureDelete === "function") App.onFeatureDelete();
          e.preventDefault();
        }
      }
    });

    // Buffer radius input (stations)
    document.getElementById("bufferRadius").addEventListener("input", function () {
      var val = parseFloat(this.value);
      if (isNaN(val) || val < 0) val = 0;
      App.rebuildBuffers(val);
      notifyProject();
      if (typeof App.cache !== "undefined") App.cache.save();
    });

    // Buffer radius input (lines)
    document.getElementById("lineBufferRadius").addEventListener("input", function () {
      var val = parseFloat(this.value);
      if (isNaN(val) || val < 0) val = 0;
      App.rebuildLineBuffers(val);
      notifyProject();
      if (typeof App.cache !== "undefined") App.cache.save();
    });

    // Buffer radius input (routes)
    document.getElementById("routeBufferRadius").addEventListener("input", function () {
      var val = parseFloat(this.value);
      if (isNaN(val) || val < 0) val = 0;
      App.rebuildRouteBuffers(val);
      notifyProject();
      if (typeof App.cache !== "undefined") App.cache.save();
    });

    // Line width inputs (visual only — no notifyProject)
    document.getElementById("stationLineWidth").addEventListener("input", function () {
      var w = Math.min(5, Math.max(1, parseFloat(this.value) || 1));
      App.map.setPaintProperty("stations-layer", "circle-radius", 6 * w);
      App.map.setPaintProperty("stations-layer", "circle-stroke-width", 2 * w);
      if (typeof App.cache !== "undefined") App.cache.save();
    });

    document.getElementById("lineLineWidth").addEventListener("input", function () {
      var w = Math.min(5, Math.max(1, parseFloat(this.value) || 1));
      App.map.setPaintProperty("lines-layer", "line-width", 3 * w);
      if (typeof App.cache !== "undefined") App.cache.save();
    });

    document.getElementById("routeLineWidth").addEventListener("input", function () {
      var w = Math.min(5, Math.max(1, parseFloat(this.value) || 1));
      App.map.setPaintProperty("routes-layer", "line-width", 3 * w);
      if (typeof App.cache !== "undefined") App.cache.save();
    });

    document.getElementById("polygonLineWidth").addEventListener("input", function () {
      var w = Math.min(5, Math.max(1, parseFloat(this.value) || 1));
      App.map.setPaintProperty("polygons-outlines-layer", "line-width", 3 * w);
      if (typeof App.cache !== "undefined") App.cache.save();
    });

    // Map click: dispatch based on draw mode
    App.map.on("click", function (e) {
      if (App.drawMode === "station") {
        App.addStationPoint(e.lngLat.lng, e.lngLat.lat);
        notifyProject();
        if (typeof App.cache !== "undefined") App.cache.save();
      } else if (App.drawMode === "line") {
        App.handleLineClick(e.lngLat);
        notifyProject();
        if (typeof App.cache !== "undefined") App.cache.save();
      } else if (App.drawMode === "route") {
        App.handleRouteClick(e.lngLat).then(function () {
          notifyProject();
          if (typeof App.cache !== "undefined") App.cache.save();
        });
      } else if (App.drawMode === "polygon") {
        App.handlePolygonClick(e.lngLat);
        notifyProject();
        if (typeof App.cache !== "undefined") App.cache.save();
      }
    });

    // Map mousemove: rubber-band preview for line/route/polygon drawing
    App.map.on("mousemove", function (e) {
      if (App.drawMode === "line") {
        App.setLinePreview(e.lngLat);
      } else if (App.drawMode === "route") {
        App.setRoutePreview(e.lngLat);
      } else if (App.drawMode === "polygon") {
        App.setPolygonPreview(e.lngLat);
      }
    });

    // Clear stations
    document.getElementById("clear").addEventListener("click", function () {
      if (!confirm("Clear all features? This cannot be undone.")) return;
      if (typeof App.exitEditMode === "function") App.exitEditMode();
      App.clearStations();
      App.clearLines();
      App.clearRoutes();
      App.clearPolygons();
      if (typeof App.refreshFeaturePanel === "function") App.refreshFeaturePanel();
      if (typeof App.clearCensusOverlay === "function") App.clearCensusOverlay();
      document.getElementById("nGeos").textContent = "0";
      document.getElementById("summaryStatus").style.display = "none";
      App.setStatus("Cleared");
      clearModules();
      notifyProject();
      if (typeof App.cache !== "undefined") App.cache.save();
    });

    // Undo last station/waypoint/feature
    document.getElementById("undo").addEventListener("click", function () {
      if (App.drawMode === "line") {
        App.undoLastLine();
        notifyProject();
        if (typeof App.cache !== "undefined") App.cache.save();
      } else if (App.drawMode === "route") {
        App.undoLastRoute();
        notifyProject();
        if (typeof App.cache !== "undefined") App.cache.save();
      } else if (App.drawMode === "polygon") {
        App.undoLastPolygon();
        notifyProject();
        if (typeof App.cache !== "undefined") App.cache.save();
      } else if (App.stations.length > 0) {
        App.undoLastStation();
        App.setStatus("Updated");
        notifyProject();
        if (typeof App.cache !== "undefined") App.cache.save();
      }
    });

    // LODES download
    document.getElementById("downloadLodes").addEventListener("click", async function () {
      try {
        App.setStatus("Determining state\u2026");
        var info = await App.getStateFromMapCenter();
        document.getElementById("lodesState").textContent = info.abbr.toUpperCase() + " (FIPS " + info.stateFips + ")";

        var lodesYear = "2023";
        var url = "https://lehd.ces.census.gov/data/lodes/LODES8/" + info.abbr + "/wac/" + info.abbr + "_wac_S000_JT00_" + lodesYear + ".csv.gz";
        var filename = info.abbr + "_wac_S000_JT00_" + lodesYear + ".csv.gz";

        document.getElementById("lodesInfo").textContent =
          "Downloading " + filename + ". Click Add to load into map data.";
        App.setStatus("Starting download\u2026");
        App.startDownload(url, filename);
        App.setStatus("Ready");
      } catch (e) {
        App.setStatus("Error");
        document.getElementById("lodesInfo").textContent = String(e && e.message ? e.message : e);
      }
    });

    // LODES "Open" button — triggers the hidden file input
    document.getElementById("lodesOpenFile").addEventListener("click", function () {
      document.getElementById("lodesFile").click();
    });

    // LODES file upload — merges into any already-loaded state data
    document.getElementById("lodesFile").addEventListener("change", async function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      this.value = ""; // allow re-selecting the same file
      try {
        var jobsMap = await App.parseLodesFromUploadedFile(file);
        App.mergeLodesFile(jobsMap, file.name);
        App.setStatus("Ready");
        notifyProject();
        if (typeof App.cache !== "undefined") App.cache.save();
      } catch (err) {
        App.setStatus("Error");
        var infoEl = document.getElementById("lodesInfo");
        if (infoEl) infoEl.textContent = "Error loading " + file.name + ": " + String(err && err.message ? err.message : err);
      }
    });

    // LODES clear-all button
    var lodesClearBtn = document.getElementById("lodesClearAll");
    if (lodesClearBtn) {
      lodesClearBtn.addEventListener("click", function () {
        if (!confirm("Remove all loaded LODES data?")) return;
        App.clearLodesData();
        notifyProject();
        if (typeof App.cache !== "undefined") App.cache.save();
      });
    }

    // PPACG Projection UI has moved to the Ridership Forecasting Projections tab.

    // Reset session button: clear everything AND localStorage
    var resetBtn = document.getElementById("reset");
    if (resetBtn) {
      resetBtn.addEventListener("click", function () {
        if (!confirm("Reset session? This clears all features, settings, and saved data. This cannot be undone.")) return;
        if (typeof App.cache !== "undefined") App.cache.reset();
        if (typeof App.clearCensusOverlay === "function") App.clearCensusOverlay();
        clearModules();
        notifyProject();
      });
    }

    // ---- Import / Export ----
    document.getElementById("fp-export").addEventListener("click", function () {
      if (typeof App.cache !== "undefined") App.cache.exportToFile();
    });

    var importFileInput = document.getElementById("fp-import-file");
    document.getElementById("fp-import").addEventListener("click", function () {
      importFileInput.value = "";   // allow re-importing same file
      importFileInput.click();
    });
    importFileInput.addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      if (typeof App.cache !== "undefined") App.cache.importFromFile(file);
    });

    // Save on checkbox / dropdown changes
    document.querySelectorAll('#varSelect input[type="checkbox"]').forEach(function (cb) {
      cb.addEventListener("change", function () {
        if (typeof App.cache !== "undefined") App.cache.save();
      });
    });
    var lodesCbSave = document.getElementById("lodesCheckbox");
    if (lodesCbSave) {
      lodesCbSave.addEventListener("change", function () {
        if (typeof App.cache !== "undefined") App.cache.save();
      });
    }

    // Restore cached session (runs after sidebar, events, and project init are all ready)
    if (typeof App.cache !== "undefined" && App.cache.restore()) {
      App.setStatus("Session restored");
      notifyProject();
    }
  });
})();
