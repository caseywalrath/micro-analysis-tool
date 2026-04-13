// js/app.js
// Startup: wires core modules together, loads active project panel,
// contains summary runners and core event bindings.
// Depends on: all core modules (utils, map, points, census, lodes).
// Exports: registerProject

(function () {
  var App = window.App;

  // ---- Draw mode ----

  App.drawMode = null; // null | "point" | "line" | "route" | "polygon" | "label" | "measure"

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

  // Override bufferUnionPolygon to include line and route buffers alongside point buffers.
  // Must happen before any user interaction; census.js and lodes.js call this at runtime.
  var _pointUnion = App.bufferUnionPolygon;
  App.bufferUnionPolygon = function () {
    var su = _pointUnion();
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
      points: App.points,
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

  // ---- Overlap offset computation ----

  var _computingOffsets = false;
  var OVERLAP_PROXIMITY_MI = 0.015; // ~80ft — same-street detection
  var OFFSET_PX = 3;

  App.computeOverlapOffsets = function () {
    if (_computingOffsets) return;
    _computingOffsets = true;
    try {
      var features = [];
      (App.lines || []).forEach(function (f, i) { if (!f.properties.hidden) features.push({ src: "line", idx: i, feature: f }); });
      (App.routes || []).forEach(function (f, i) { if (!f.properties.hidden) features.push({ src: "route", idx: i, feature: f }); });

      // Clear all offsets first
      for (var k = 0; k < features.length; k++) {
        if (features[k].feature.properties) features[k].feature.properties._offset = 0;
      }

      if (features.length < 2) { _pushOffsetSources(); _computingOffsets = false; return; }

      // Build tiny proximity buffers
      var miniBufs = [];
      for (var i = 0; i < features.length; i++) {
        try {
          miniBufs.push(turf.buffer(features[i].feature, OVERLAP_PROXIMITY_MI, { units: "miles", steps: 4 }));
        } catch (e) { miniBufs.push(null); }
      }

      // Pairwise overlap detection
      var adj = [];
      for (var i = 0; i < features.length; i++) adj.push([]);
      for (var i = 0; i < features.length; i++) {
        if (!miniBufs[i]) continue;
        for (var j = i + 1; j < features.length; j++) {
          if (!miniBufs[j]) continue;
          try {
            if (turf.booleanIntersects(miniBufs[i], miniBufs[j])) {
              adj[i].push(j);
              adj[j].push(i);
            }
          } catch (e) { /* skip */ }
        }
      }

      // BFS connected components → assign spread offsets
      var visited = [];
      for (var i = 0; i < features.length; i++) visited.push(false);

      for (var i = 0; i < features.length; i++) {
        if (visited[i] || adj[i].length === 0) continue;
        var group = [];
        var queue = [i];
        visited[i] = true;
        while (queue.length > 0) {
          var cur = queue.shift();
          group.push(cur);
          for (var ni = 0; ni < adj[cur].length; ni++) {
            var nb = adj[cur][ni];
            if (!visited[nb]) { visited[nb] = true; queue.push(nb); }
          }
        }
        var n = group.length;
        for (var gi = 0; gi < n; gi++) {
          var offset = (gi - (n - 1) / 2) * OFFSET_PX;
          features[group[gi]].feature.properties._offset = offset;
        }
      }

      _pushOffsetSources();
    } finally {
      _computingOffsets = false;
    }
  };

  App.clearOverlapOffsets = function () {
    if (_computingOffsets) return;
    _computingOffsets = true;
    try {
      (App.lines || []).forEach(function (f) { if (f.properties) f.properties._offset = 0; });
      (App.routes || []).forEach(function (f) { if (f.properties) f.properties._offset = 0; });
      _pushOffsetSources();
    } finally {
      _computingOffsets = false;
    }
  };

  function _pushOffsetSources() {
    var map = App.map;
    if (!map) return;
    var ls = map.getSource("lines");
    if (ls) ls.setData({ type: "FeatureCollection", features: (App.lines || []).filter(function (f) { return !f.properties.hidden; }) });
    var rs = map.getSource("routes");
    if (rs) rs.setData({ type: "FeatureCollection", features: (App.routes || []).filter(function (f) { return !f.properties.hidden; }) });
  }

  // ---- Feature deletion hook ----

  App.onFeatureDelete = function () {
    if (typeof App.exitEditMode === "function") App.exitEditMode();
    if (typeof App.clearSelection === "function") App.clearSelection();
    if (typeof App.refreshFeaturePanel === "function") App.refreshFeaturePanel();
    notifyProject();
    if (typeof App.cache !== "undefined") App.cache.save();
  };

  // ---- Feature Settings: centralized state + apply helpers ----

  App.featureSettings = {
    pointOpacity:      100,
    lineOpacity:       100,
    routeOpacity:      100,
    polygonOpacity:    50,
    bufferOpacity:     50,
    bufferRadius:      0,
    lineBufferRadius:  0,
    routeBufferRadius: 0,
    pointLineWidth:    1,
    lineLineWidth:     1,
    routeLineWidth:    1,
    polygonLineWidth:  1,
    bufferLineWidth:   1
  };

  function _safeSetPaint(layerId, prop, val) {
    if (App.map && App.map.getLayer(layerId)) {
      App.map.setPaintProperty(layerId, prop, val);
    }
  }

  function _polyOpacityValues(S) {
    if (S <= 50) {
      var t = S / 50;
      return { fill: 0.15 * t, border: 0.8 * t };
    }
    var t = (S - 50) / 50;
    return { fill: 0.15 + 0.85 * t, border: 0.8 + 0.2 * t };
  }

  function _bufOpacityValues(S) {
    if (S <= 50) {
      var t = S / 50;
      return { fill: 0.08 * t, border: 0.4 * t };
    }
    var t = (S - 50) / 50;
    return { fill: 0.08 + 0.92 * t, border: 0.4 + 0.6 * t };
  }

  App._polyOpacityValues = _polyOpacityValues;

  App.applyFeatureOpacity = function (type) {
    var fs = App.featureSettings;
    if (type === "point" || type === "all") {
      var op = fs.pointOpacity / 100;
      var opExpr = ["case", ["has", "_opacity"], ["get", "_opacity"], op];
      _safeSetPaint("points-layer", "circle-opacity", opExpr);
      _safeSetPaint("points-layer", "circle-stroke-opacity", opExpr);
    }
    if (type === "line" || type === "all") {
      _safeSetPaint("lines-layer", "line-opacity",
        ["case", ["has", "_opacity"], ["get", "_opacity"], fs.lineOpacity / 100]);
    }
    if (type === "route" || type === "all") {
      _safeSetPaint("routes-layer", "line-opacity",
        ["case", ["has", "_opacity"], ["get", "_opacity"], fs.routeOpacity / 100]);
    }
    if (type === "polygon" || type === "all") {
      var pc = _polyOpacityValues(fs.polygonOpacity);
      _safeSetPaint("polygons-fill", "fill-opacity",
        ["case", ["has", "_fillOpacity"], ["get", "_fillOpacity"], pc.fill]);
      _safeSetPaint("polygons-outlines-layer", "line-opacity",
        ["case", ["has", "_borderOpacity"], ["get", "_borderOpacity"], pc.border]);
    }
    if (type === "buffer" || type === "all") {
      var bc = _bufOpacityValues(fs.bufferOpacity);
      _safeSetPaint("buffers-fill", "fill-opacity", bc.fill);
      _safeSetPaint("buffers-line", "line-opacity", bc.border);
      _safeSetPaint("line-buffers-fill", "fill-opacity", bc.fill);
      _safeSetPaint("line-buffers-line", "line-opacity", bc.border);
      _safeSetPaint("route-buffers-fill", "fill-opacity", bc.fill);
      _safeSetPaint("route-buffers-line", "line-opacity", bc.border);
    }
  };

  App.applyLineWidth = function (type) {
    var fs = App.featureSettings;
    if (type === "point" || type === "all") {
      _safeSetPaint("points-layer", "circle-radius",
        ["case", ["has", "_lineWidth"], ["*", 6, ["get", "_lineWidth"]], 6 * fs.pointLineWidth]);
      _safeSetPaint("points-layer", "circle-stroke-width",
        ["case", ["has", "_lineWidth"], ["*", 2, ["get", "_lineWidth"]], 2 * fs.pointLineWidth]);
    }
    if (type === "line" || type === "all") {
      _safeSetPaint("lines-layer", "line-width",
        ["case", ["has", "_lineWidth"], ["*", 3, ["get", "_lineWidth"]], 3 * fs.lineLineWidth]);
    }
    if (type === "route" || type === "all") {
      _safeSetPaint("routes-layer", "line-width",
        ["case", ["has", "_lineWidth"], ["*", 3, ["get", "_lineWidth"]], 3 * fs.routeLineWidth]);
    }
    if (type === "polygon" || type === "all") {
      _safeSetPaint("polygons-outlines-layer", "line-width",
        ["case", ["has", "_lineWidth"], ["*", 3, ["get", "_lineWidth"]], 3 * fs.polygonLineWidth]);
    }
  };

  App.applyBufferLineWidth = function () {
    var w = App.featureSettings.bufferLineWidth;
    _safeSetPaint("buffers-line", "line-width", 2 * w);
    _safeSetPaint("line-buffers-line", "line-width", 2 * w);
    _safeSetPaint("route-buffers-line", "line-width", 2 * w);
  };

  // ---- Map load: wire everything ----

  App.map.on("load", async function () {
    App.setStatus("Ready");
    App.renderPointLayers();
    App.renderLineLayers();
    App.renderRouteLayers();
    App.renderPolygonLayers();
    if (typeof App.renderLabelMarkers === "function") App.renderLabelMarkers();

    // Initialize measure tool layers
    if (typeof App.initMeasureLayers === "function") App.initMeasureLayers();

    // Initialize feature editing (point drag, vertex editing)
    if (typeof App._initEditing === "function") App._initEditing();

    // Initialize hover/selection highlight layers
    if (typeof App.initHighlightLayers === "function") App.initHighlightLayers();

    // ---- Sidebar disabled (scaffolding kept for future use) ----
    // Panels formerly registered here have been relocated:
    // - Census checkboxes → Feature Area Analysis popup (buffer-summary.js)
    // - LODES → Add Data dropdown (index.html)
    // - Analysis modules → Analysis toolbar dropdown (below)

    // Wire popup system
    App.popup.wire(_modules, buildCore);

    // Populate Analysis toolbar dropdown with module buttons
    var analysisDropdown = document.getElementById("analysis-dropdown");
    if (analysisDropdown && _modules.size > 0) {
      analysisDropdown.innerHTML = buildAnalysisButtonsHTML();
      analysisDropdown.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-module-id]");
        if (!btn || btn.disabled) return;
        analysisDropdown.style.display = "none";
        App.popup.open(btn.getAttribute("data-module-id"), _modules, buildCore);
      });
    }

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
        if (prevMode === "measure" && App.drawMode !== "measure") {
          if (typeof App.clearMeasure === "function") App.clearMeasure();
        }

        // Clear any lingering preview coordinates
        if (typeof App.setLinePreview === "function") App.setLinePreview(null);
        if (typeof App.setRoutePreview === "function") App.setRoutePreview(null);
        if (typeof App.setPolygonPreview === "function") App.setPolygonPreview(null);
        if (typeof App.setMeasurePreview === "function") App.setMeasurePreview(null);

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

    // Variable checkbox Select All / Clear All — now wired in buffer-summary.js init()

    // Dark mode toggle
    var _darkBtn = document.getElementById("darkmode-btn");
    var _DARK_KEY = "mat-dark-mode";
    if (_darkBtn) {
      _darkBtn.addEventListener("click", function () {
        var isDark = document.body.classList.toggle("dark-mode");
        localStorage.setItem(_DARK_KEY, isDark ? "1" : "0");
        if (typeof App.switchBasemap === "function") {
          App.switchBasemap(isDark ? "carto-dark" : "carto-light");
        }
      });
    }
    // Restore basemap to match dark mode preference (class already set by no-flash script in <head>)
    if (document.body.classList.contains("dark-mode") && typeof App.switchBasemap === "function") {
      App.switchBasemap("carto-dark");
    }

    // Present mode
    document.getElementById("present-btn").addEventListener("click", function () {
      document.body.classList.add("present-mode");
      App.map.resize();
    });
    document.getElementById("present-exit").addEventListener("click", function () {
      document.body.classList.remove("present-mode");
      App.map.resize();
    });

    // Keyboard shortcuts
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && document.body.classList.contains("present-mode")) {
        document.body.classList.remove("present-mode");
        App.map.resize();
        return;
      }
      if (e.key === "Escape" && App.drawMode === "measure") {
        if (typeof App.clearMeasure === "function") App.clearMeasure();
        App.exitDrawMode();
        App.setStatus("Ready");
        return;
      }
      if (e.key === "Escape" && App.popup.isOpen()) {
        App.popup.close();
      }
      var tag = e.target.tagName;
      // Ctrl+Z / Cmd+Z = Undo
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === "z" || e.key === "Z")) {
        if (tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable) return;
        document.getElementById("undo-btn").click();
        e.preventDefault();
        return;
      }
      // Ctrl+Shift+Z / Cmd+Shift+Z = Redo
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "z" || e.key === "Z")) {
        if (tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable) return;
        document.getElementById("redo-btn").click();
        e.preventDefault();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
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

    // ---- Feature Settings slider popover ----

    var OPACITY_SVG = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="8" cy="8" r="6" stroke-dasharray="3 2"/></svg>';
    var BUFFER_SVG  = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2" fill="currentColor" stroke="none"/></svg>';
    var WIDTH_SVG   = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round"><line x1="2" y1="8" x2="14" y2="8" stroke-width="2.5"/></svg>';

    // Populate icon buttons with SVGs
    var _iconDefs = [
      ["fp-set-pointOpacity",      OPACITY_SVG],
      ["fp-set-lineOpacity",       OPACITY_SVG],
      ["fp-set-routeOpacity",      OPACITY_SVG],
      ["fp-set-polygonOpacity",    OPACITY_SVG],
      ["fp-set-bufferOpacity",     OPACITY_SVG],
      ["fp-set-bufferRadius",      BUFFER_SVG],
      ["fp-set-lineBufferRadius",  BUFFER_SVG],
      ["fp-set-routeBufferRadius", BUFFER_SVG],
      ["fp-set-pointLineWidth",    WIDTH_SVG],
      ["fp-set-lineLineWidth",     WIDTH_SVG],
      ["fp-set-routeLineWidth",    WIDTH_SVG],
      ["fp-set-polygonLineWidth",  WIDTH_SVG],
      ["fp-set-bufferLineWidth",   WIDTH_SVG]
    ];
    _iconDefs.forEach(function (pair) {
      var el = document.getElementById(pair[0]);
      if (el) el.innerHTML = pair[1];
    });

    var _fpActiveBtn = null;

    function _closeFpSlider() {
      var pop = document.getElementById("fp-slider-popover");
      if (pop) pop.style.display = "none";
      if (_fpActiveBtn) { _fpActiveBtn.classList.remove("fp-sib-active"); _fpActiveBtn = null; }
    }

    function _openFpSlider(btn, cfg) {
      // Toggle off if same button clicked again
      if (_fpActiveBtn === btn) { _closeFpSlider(); return; }
      _closeFpSlider();

      var pop = document.getElementById("fp-slider-popover");
      if (!pop) return;
      var slider = document.getElementById("fp-slider-input");
      var valEl  = document.getElementById("fp-slider-value");
      var unitEl = document.getElementById("fp-slider-unit");
      if (!slider || !valEl) return;

      slider.min   = cfg.min;
      slider.max   = cfg.max;
      slider.step  = cfg.step;
      var initVal = (cfg.value != null) ? cfg.value : (cfg.key ? App.featureSettings[cfg.key] : 0);
      slider.value = initVal;
      valEl.textContent  = _fmtSlider(initVal, cfg);
      if (unitEl) unitEl.textContent = cfg.unit || "";

      slider.oninput = function () {
        var v = parseFloat(this.value);
        if (cfg.key) App.featureSettings[cfg.key] = v;
        valEl.textContent = _fmtSlider(v, cfg);
        cfg.onChange(v);
        if (cfg.key && typeof App.cache !== "undefined") App.cache.save();
      };

      // Position popover below (or above) the icon
      var rect = btn.getBoundingClientRect();
      var popW = 44, popH = 160;
      var left = rect.left + rect.width / 2 - popW / 2;
      var top  = rect.bottom + 6;
      if (top + popH > window.innerHeight - 8) top = rect.top - popH - 6;
      left = Math.max(4, Math.min(left, window.innerWidth - popW - 4));
      pop.style.left    = Math.round(left) + "px";
      pop.style.top     = Math.round(top)  + "px";
      pop.style.display = "flex";

      btn.classList.add("fp-sib-active");
      _fpActiveBtn = btn;
    }

    function _fmtSlider(v, cfg) {
      if (cfg.step < 1) return parseFloat(v).toFixed(1);
      return Math.round(v).toString();
    }

    // Close on outside mousedown (not click — avoids missing fast drags)
    document.addEventListener("mousedown", function (e) {
      if (!_fpActiveBtn) return;
      var pop = document.getElementById("fp-slider-popover");
      if (!pop) return;
      if (!pop.contains(e.target) && e.target !== _fpActiveBtn && !_fpActiveBtn.contains(e.target)) {
        _closeFpSlider();
      }
    }, true);

    // Wire each icon button
    function _wireFpBtn(id, cfg) {
      var btn = document.getElementById(id);
      if (!btn) return;
      btn.addEventListener("click", function (e) { e.stopPropagation(); _openFpSlider(btn, cfg); });
      btn.addEventListener("dblclick", function (e) {
        e.stopPropagation();
        App.featureSettings[cfg.key] = cfg.def;
        cfg.onChange(cfg.def);
        if (typeof App.cache !== "undefined") App.cache.save();
        // If this slider is currently open, sync its display
        if (_fpActiveBtn === btn) {
          var slider = document.getElementById("fp-slider-input");
          var valEl  = document.getElementById("fp-slider-value");
          if (slider) slider.value = cfg.def;
          if (valEl)  valEl.textContent = _fmtSlider(cfg.def, cfg);
        }
      });
    }

    _wireFpBtn("fp-set-pointOpacity",      { key:"pointOpacity",      def:100, min:0, max:100, step:1,   unit:"%",  onChange: function() { App.applyFeatureOpacity("point"); } });
    _wireFpBtn("fp-set-lineOpacity",       { key:"lineOpacity",        def:100, min:0, max:100, step:1,   unit:"%",  onChange: function() { App.applyFeatureOpacity("line"); } });
    _wireFpBtn("fp-set-routeOpacity",      { key:"routeOpacity",       def:100, min:0, max:100, step:1,   unit:"%",  onChange: function() { App.applyFeatureOpacity("route"); } });
    _wireFpBtn("fp-set-polygonOpacity",    { key:"polygonOpacity",     def:50,  min:0, max:100, step:1,   unit:"%",  onChange: function() { App.applyFeatureOpacity("polygon"); } });
    _wireFpBtn("fp-set-bufferOpacity",     { key:"bufferOpacity",      def:50,  min:0, max:100, step:1,   unit:"%",  onChange: function() { App.applyFeatureOpacity("buffer"); } });
    _wireFpBtn("fp-set-bufferRadius",      { key:"bufferRadius",       def:0,   min:0, max:2,   step:0.1, unit:"mi", onChange: function(v) { App.rebuildBuffers(v); notifyProject(); } });
    _wireFpBtn("fp-set-lineBufferRadius",  { key:"lineBufferRadius",   def:0,   min:0, max:2,   step:0.1, unit:"mi", onChange: function(v) { App.rebuildLineBuffers(v); notifyProject(); } });
    _wireFpBtn("fp-set-routeBufferRadius", { key:"routeBufferRadius",  def:0,   min:0, max:2,   step:0.1, unit:"mi", onChange: function(v) { App.rebuildRouteBuffers(v); notifyProject(); } });
    _wireFpBtn("fp-set-pointLineWidth",    { key:"pointLineWidth",     def:1,   min:0, max:5,   step:0.1, unit:"×",  onChange: function() { App.applyLineWidth("point"); } });
    _wireFpBtn("fp-set-lineLineWidth",     { key:"lineLineWidth",      def:1,   min:0, max:5,   step:0.1, unit:"×",  onChange: function() { App.applyLineWidth("line"); } });
    _wireFpBtn("fp-set-routeLineWidth",    { key:"routeLineWidth",     def:1,   min:0, max:5,   step:0.1, unit:"×",  onChange: function() { App.applyLineWidth("route"); } });
    _wireFpBtn("fp-set-polygonLineWidth",  { key:"polygonLineWidth",   def:1,   min:0, max:5,   step:0.1, unit:"×",  onChange: function() { App.applyLineWidth("polygon"); } });
    _wireFpBtn("fp-set-bufferLineWidth",   { key:"bufferLineWidth",    def:1,   min:0, max:5,   step:0.1, unit:"×",  onChange: function() { App.applyBufferLineWidth(); } });

    // Expose slider infrastructure for per-feature overrides in feature-attributes.js
    App._openFpSlider  = _openFpSlider;
    App._closeFpSlider = _closeFpSlider;

    // Offset overlapping lines/routes toggle
    document.getElementById("offsetOverlap").addEventListener("change", function () {
      if (this.checked) {
        App.computeOverlapOffsets();
      } else {
        App.clearOverlapOffsets();
      }
      if (typeof App.cache !== "undefined") App.cache.save();
    });

    // Map click: dispatch based on draw mode
    App.map.on("click", function (e) {
      if (App.drawMode === "point") {
        App.addPoint(e.lngLat.lng, e.lngLat.lat);
        notifyProject();
        if (typeof App.cache !== "undefined") App.cache.save();
      } else if (App.drawMode === "line") {
        App.handleLineClick(e.lngLat);
        if (App.undo) App.undo.updateButtons();
        notifyProject();
        if (typeof App.cache !== "undefined") App.cache.save();
      } else if (App.drawMode === "route") {
        App.handleRouteClick(e.lngLat).then(function () {
          if (App.undo) App.undo.updateButtons();
          notifyProject();
          if (typeof App.cache !== "undefined") App.cache.save();
        });
      } else if (App.drawMode === "polygon") {
        App.handlePolygonClick(e.lngLat);
        if (App.undo) App.undo.updateButtons();
        notifyProject();
        if (typeof App.cache !== "undefined") App.cache.save();
      } else if (App.drawMode === "label") {
        App.addLabel(e.lngLat.lng, e.lngLat.lat);
        notifyProject();
        if (typeof App.cache !== "undefined") App.cache.save();
      } else if (App.drawMode === "measure") {
        App.handleMeasureClick(e.lngLat);
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
      } else if (App.drawMode === "measure") {
        App.setMeasurePreview(e.lngLat);
      }
    });

    // Clear all features
    document.getElementById("clear").addEventListener("click", function () {
      if (!confirm("Clear all features?")) return;
      if (App.undo && !App.undo.isRestoring()) App.undo.push();
      if (typeof App.exitEditMode === "function") App.exitEditMode();
      App.clearPoints();
      App.clearLines();
      App.clearRoutes();
      App.clearPolygons();
      if (typeof App.clearLabels === "function") App.clearLabels();
      if (typeof App.clearRoadNetwork === "function") App.clearRoadNetwork();
      if (typeof App.osmClearLayers === "function") App.osmClearLayers();
      if (typeof App.refreshFeaturePanel === "function") App.refreshFeaturePanel();
      if (typeof App.clearCensusOverlay === "function") App.clearCensusOverlay();
      document.getElementById("nGeos").textContent = "0";
      document.getElementById("summaryStatus").style.display = "none";
      App.setStatus("Cleared");
      clearModules();
      notifyProject();
      if (typeof App.cache !== "undefined") App.cache.save();
    });

    // Undo — remove last waypoint if drawing, otherwise pop undo stack
    document.getElementById("undo-btn").addEventListener("click", function () {
      if (App.drawMode === "line" && App._lineDrawingInProgress && App._lineDrawingInProgress()) {
        App.undoLastLine();
        return;
      }
      if (App.drawMode === "route" && App._routeDrawingInProgress && App._routeDrawingInProgress()) {
        App.undoLastRoute();
        return;
      }
      if (App.drawMode === "polygon" && App._polygonDrawingInProgress && App._polygonDrawingInProgress()) {
        App.undoLastPolygon();
        return;
      }
      if (App.drawMode === "measure" && App._measureDrawingInProgress && App._measureDrawingInProgress()) {
        App.undoLastMeasurePoint();
        return;
      }
      App.undo.undo();
      notifyProject();
    });

    // Redo
    document.getElementById("redo-btn").addEventListener("click", function () {
      App.undo.redo();
      notifyProject();
    });

    // ---- LODES handlers (Add Data dropdown → LODES popup) ----
    var lodesFileInput = document.getElementById("lodesFile");
    var lodesPopup = document.getElementById("lodes-popup");

    // Build state checkbox list once
    var LODES_STATES = [
      { name: "Alabama", abbr: "al" }, { name: "Alaska", abbr: "ak" },
      { name: "Arizona", abbr: "az" }, { name: "Arkansas", abbr: "ar" },
      { name: "California", abbr: "ca" }, { name: "Colorado", abbr: "co" },
      { name: "Connecticut", abbr: "ct" }, { name: "Delaware", abbr: "de" },
      { name: "District of Columbia", abbr: "dc" }, { name: "Florida", abbr: "fl" },
      { name: "Georgia", abbr: "ga" }, { name: "Hawaii", abbr: "hi" },
      { name: "Idaho", abbr: "id" }, { name: "Illinois", abbr: "il" },
      { name: "Indiana", abbr: "in" }, { name: "Iowa", abbr: "ia" },
      { name: "Kansas", abbr: "ks" }, { name: "Kentucky", abbr: "ky" },
      { name: "Louisiana", abbr: "la" }, { name: "Maine", abbr: "me" },
      { name: "Maryland", abbr: "md" }, { name: "Massachusetts", abbr: "ma" },
      { name: "Michigan", abbr: "mi" }, { name: "Minnesota", abbr: "mn" },
      { name: "Mississippi", abbr: "ms" }, { name: "Missouri", abbr: "mo" },
      { name: "Montana", abbr: "mt" }, { name: "Nebraska", abbr: "ne" },
      { name: "Nevada", abbr: "nv" }, { name: "New Hampshire", abbr: "nh" },
      { name: "New Jersey", abbr: "nj" }, { name: "New Mexico", abbr: "nm" },
      { name: "New York", abbr: "ny" }, { name: "North Carolina", abbr: "nc" },
      { name: "North Dakota", abbr: "nd" }, { name: "Ohio", abbr: "oh" },
      { name: "Oklahoma", abbr: "ok" }, { name: "Oregon", abbr: "or" },
      { name: "Pennsylvania", abbr: "pa" }, { name: "Rhode Island", abbr: "ri" },
      { name: "South Carolina", abbr: "sc" }, { name: "South Dakota", abbr: "sd" },
      { name: "Tennessee", abbr: "tn" }, { name: "Texas", abbr: "tx" },
      { name: "Utah", abbr: "ut" }, { name: "Vermont", abbr: "vt" },
      { name: "Virginia", abbr: "va" }, { name: "Washington", abbr: "wa" },
      { name: "West Virginia", abbr: "wv" }, { name: "Wisconsin", abbr: "wi" },
      { name: "Wyoming", abbr: "wy" }
    ];
    var lodesStateList = document.getElementById("lodes-state-list");
    if (lodesStateList) {
      LODES_STATES.forEach(function (s) {
        var lbl = document.createElement("label");
        lbl.className = "lodes-state-item";
        var rb = document.createElement("input");
        rb.type = "radio";
        rb.name = "lodes-state";
        rb.value = s.abbr;
        lbl.appendChild(rb);
        lbl.appendChild(document.createTextNode(" " + s.name));
        lodesStateList.appendChild(lbl);
      });
    }

    // Open/close LODES popup
    document.getElementById("lodes-employment-btn").addEventListener("click", function () {
      addDataDropdown.style.display = "none";
      lodesPopup.style.display = lodesPopup.style.display === "none" ? "block" : "none";
    });
    document.getElementById("lodes-popup-close").addEventListener("click", function () {
      lodesPopup.style.display = "none";
    });

    // Download
    document.getElementById("lodes-popup-download").addEventListener("click", function () {
      var selected = lodesStateList ? lodesStateList.querySelector("input[type=radio]:checked") : null;
      if (!selected) { App.setStatus("No state selected."); return; }
      var abbr = selected.value;
      var year = "2023";
      var url = "https://lehd.ces.census.gov/data/lodes/LODES8/" + abbr + "/wac/" + abbr + "_wac_S000_JT00_" + year + ".csv.gz";
      App.startDownload(url, abbr + "_wac_S000_JT00_" + year + ".csv.gz");
      App.setStatus("Downloading " + abbr.toUpperCase() + " LODES data\u2026");
    });

    // Add to Map
    document.getElementById("lodes-popup-add").addEventListener("click", function () {
      lodesFileInput.value = "";
      lodesFileInput.click();
    });

    lodesFileInput.addEventListener("change", async function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      this.value = "";
      try {
        var jobsMap = await App.parseLodesFromUploadedFile(file);
        App.mergeLodesFile(jobsMap, file.name);
        App.setStatus("LODES loaded (" + file.name + ")");
        updateAddDataClearIcons();
        notifyProject();
        if (typeof App.cache !== "undefined") App.cache.save();
      } catch (err) {
        App.setStatus("LODES error: " + String(err && err.message ? err.message : err));
      }
    });

    // PPACG Projection UI has moved to the Ridership Forecasting Projections tab.

    // Reset session button: clear everything AND localStorage
    var resetBtn = document.getElementById("reset");
    if (resetBtn) {
      resetBtn.addEventListener("click", function () {
        if (!confirm("Reset session? This clears all features, settings, and saved data. This cannot be undone.")) return;
        if (typeof App.cache !== "undefined") App.cache.reset();
        if (typeof App.clearRoadNetwork === "function") App.clearRoadNetwork();
        if (typeof App.clearCensusOverlay === "function") App.clearCensusOverlay();
        clearModules();
        notifyProject();
      });
    }

    // ---- Import / Export / Add Data (toolbar buttons) ----
    var importFileInput = document.getElementById("fp-import-file");
    var exportDropdown = document.getElementById("export-dropdown");
    var addDataDropdown = document.getElementById("add-data-dropdown");

    // Import file button (inside Add Data dropdown) → open file picker
    document.getElementById("import-file-btn").addEventListener("click", function () {
      addDataDropdown.style.display = "none";
      importFileInput.value = "";
      importFileInput.click();
    });

    // Municipal Boundaries toggle
    var _muniBoundariesActive = false;
    document.getElementById("muni-boundaries-btn").addEventListener("click", function () {
      addDataDropdown.style.display = "none";
      _muniBoundariesActive = !_muniBoundariesActive;
      this.classList.toggle("add-data-active", _muniBoundariesActive);
      if (typeof App.toggleMuniBoundaries === "function") App.toggleMuniBoundaries(_muniBoundariesActive);
    });

    // ---- Add Data clear + eye icons ----
    var _CLRSVG = '<svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="5.5" cy="5.5" r="4.5"/><line x1="3.5" y1="3.5" x2="7.5" y2="7.5"/><line x1="7.5" y1="3.5" x2="3.5" y2="7.5"/></svg>';
    var _EYESVG_OPEN   = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1 6s2.5-4 5-4 5 4 5 4-2.5 4-5 4-5-4-5-4z"/><circle cx="6" cy="6" r="1.5"/></svg>';
    var _EYESVG_CLOSED = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1 6s2.5-4 5-4 5 4 5 4-2.5 4-5 4-5-4-5-4z"/><circle cx="6" cy="6" r="1.5"/><line x1="2" y1="10" x2="10" y2="2"/></svg>';

    var _adClrCfgs = [
      {
        btnId: "gtfs-load-btn",
        isLoaded: function () {
          return !!(App.map && typeof App.map.getLayer === "function" && App.map.getLayer("gtfs-shapes-layer"));
        },
        clear: function () {
          if (typeof App.clearGTFS === "function") App.clearGTFS();
        },
        hasEye: true,
        isVisible: function () {
          return !!(App.map.getLayer("gtfs-shapes-layer") &&
            App.map.getLayoutProperty("gtfs-shapes-layer", "visibility") !== "none");
        },
        setVisible: function (v) {
          if (typeof App.setGtfsLayersVisible === "function") App.setGtfsLayersVisible(v);
        }
      },
      {
        btnId: "lodes-employment-btn",
        isLoaded: function () { return !!App.lodesData; },
        clear: function () {
          if (typeof App.clearLodesData === "function") App.clearLodesData();
        }
      },
      {
        osmCat: "bus_stops",
        isLoaded: function () {
          return typeof App.osmActiveCategory === "function" && App.osmActiveCategory() === "bus_stops";
        },
        clear: function () {
          if (typeof App.osmToggleCategory === "function") App.osmToggleCategory("bus_stops");
        },
        hasEye: true,
        isVisible: function () {
          return !!(App.map.getLayer("osm-points-layer") &&
            App.map.getLayoutProperty("osm-points-layer", "visibility") !== "none");
        },
        setVisible: function (v) {
          if (App.map.getLayer("osm-points-layer"))
            App.map.setLayoutProperty("osm-points-layer", "visibility", v ? "visible" : "none");
        }
      },
      {
        osmCat: "transit_routes",
        isLoaded: function () {
          return typeof App.osmActiveCategory === "function" && App.osmActiveCategory() === "transit_routes";
        },
        clear: function () {
          if (typeof App.osmToggleCategory === "function") App.osmToggleCategory("transit_routes");
        },
        hasEye: true,
        isVisible: function () {
          return !!(App.map.getLayer("osm-lines-layer") &&
            App.map.getLayoutProperty("osm-lines-layer", "visibility") !== "none");
        },
        setVisible: function (v) {
          if (App.map.getLayer("osm-lines-layer"))
            App.map.setLayoutProperty("osm-lines-layer", "visibility", v ? "visible" : "none");
        }
      },
      {
        btnId: "osm-poi-btn",
        isLoaded: function () {
          return typeof App.osmPoiLoaded === "function" && App.osmPoiLoaded();
        },
        clear: function () {
          if (typeof App.clearOsmPois === "function") App.clearOsmPois();
        },
        hasEye: true,
        isVisible: function () {
          return !!(App.map.getLayer("osm-poi-layer") &&
            App.map.getLayoutProperty("osm-poi-layer", "visibility") !== "none");
        },
        setVisible: function (v) {
          if (typeof App.setOsmPoiLayerVisible === "function") App.setOsmPoiLayerVisible(v);
        }
      },
      {
        btnId: "road-net-download",
        isLoaded: function () {
          return typeof App.roadNetworkLoaded === "function" && App.roadNetworkLoaded();
        },
        clear: function () {
          if (typeof App.clearRoadNetwork === "function") App.clearRoadNetwork();
        }
      },
      {
        btnId: "muni-boundaries-btn",
        isLoaded: function () { return _muniBoundariesActive; },
        clear: function () {
          _muniBoundariesActive = false;
          var b = document.getElementById("muni-boundaries-btn");
          if (b) b.classList.remove("add-data-active");
          if (typeof App.toggleMuniBoundaries === "function") App.toggleMuniBoundaries(false);
        },
        hasEye: true,
        isVisible: function () {
          return !!(App.map.getLayer("muni-boundaries-line") &&
            App.map.getLayoutProperty("muni-boundaries-line", "visibility") !== "none");
        },
        setVisible: function (v) {
          if (typeof App.setMuniBoundariesLayerVisible === "function") App.setMuniBoundariesLayerVisible(v);
        }
      }
    ];

    _adClrCfgs.forEach(function (cfg) {
      var btn = cfg.btnId
        ? document.getElementById(cfg.btnId)
        : addDataDropdown.querySelector("button[data-osm='" + cfg.osmCat + "']");
      if (!btn) return;

      // Eye icon (left of clear) — only for items with a persistent map layer
      if (cfg.hasEye) {
        var eyeSpan = document.createElement("span");
        eyeSpan.className = "add-data-eye";
        eyeSpan.style.display = "none";
        eyeSpan.addEventListener("click", function (e) {
          e.stopPropagation();
          cfg.setVisible(!cfg.isVisible());
          updateAddDataClearIcons();
        });
        btn.appendChild(eyeSpan);
        cfg._eyeSpan = eyeSpan;
      }

      // Clear icon (right)
      var span = document.createElement("span");
      span.className = "add-data-clr";
      span.innerHTML = _CLRSVG;
      span.style.display = "none";
      span.addEventListener("click", function (e) {
        e.stopPropagation();
        cfg.clear();
        updateAddDataClearIcons();
        notifyProject();
        if (typeof App.cache !== "undefined") App.cache.save();
      });
      btn.appendChild(span);
      cfg._span = span;
    });

    function updateAddDataClearIcons() {
      _adClrCfgs.forEach(function (cfg) {
        var loaded = cfg.isLoaded();
        if (cfg._span) cfg._span.style.display = loaded ? "inline-flex" : "none";
        if (cfg._eyeSpan) {
          cfg._eyeSpan.style.display = loaded ? "inline-flex" : "none";
          if (loaded) cfg._eyeSpan.innerHTML = cfg.isVisible() ? _EYESVG_OPEN : _EYESVG_CLOSED;
        }
      });
    }

    // Route imported file by extension
    importFileInput.addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var ext = (file.name.split(".").pop() || "").toLowerCase();
      if (ext === "geojson") {
        if (typeof App.loadRoadNetworkFromFile === "function") App.loadRoadNetworkFromFile(file);
        return;
      }
      if (typeof App.cache === "undefined") return;
      if (ext === "json") {
        App.cache.importFromFile(file);
      } else if (ext === "csv") {
        App.cache.importCSV(file);
      } else if (ext === "kml" || ext === "kmz") {
        App.cache.importKML(file);
      } else if (ext === "shp" || ext === "zip") {
        App.cache.importSHP(file);
      } else {
        alert("Unsupported file format: ." + ext + "\nSupported: .json, .csv, .kml, .shp, .zip");
      }
    });

    // Analysis button → toggle dropdown
    document.getElementById("analysis-btn").addEventListener("click", function (e) {
      e.stopPropagation();
      exportDropdown.style.display = "none";
      if (addDataDropdown) addDataDropdown.style.display = "none";
      var isOpen = analysisDropdown.style.display !== "none";
      analysisDropdown.style.display = isOpen ? "none" : "block";
    });

    // Export button → toggle dropdown
    document.getElementById("export-btn").addEventListener("click", function (e) {
      e.stopPropagation();
      if (addDataDropdown) addDataDropdown.style.display = "none";
      if (analysisDropdown) analysisDropdown.style.display = "none";
      var isOpen = exportDropdown.style.display !== "none";
      exportDropdown.style.display = isOpen ? "none" : "block";
    });

    // Export dropdown item click
    exportDropdown.addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-format]");
      if (!btn) return;
      exportDropdown.style.display = "none";
      var fmt = btn.getAttribute("data-format");
      if (fmt === "road-network") {
        if (typeof App.exportRoadNetwork === "function") App.exportRoadNetwork();
        return;
      }
      if (typeof App.cache === "undefined") return;
      if (fmt === "json-features") App.cache.exportFeaturesOnly();
      else if (fmt === "json-all") App.cache.exportToFile();
      else if (fmt === "csv") App.cache.exportCSV();
      else if (fmt === "kml") App.cache.exportKML();
      else if (fmt === "shp") App.cache.exportSHP();
      else if (fmt === "share-link") App.cache.exportShareLink();
    });

    // ---- Add Data dropdown ----
    document.getElementById("add-data-btn").addEventListener("click", function (e) {
      e.stopPropagation();
      exportDropdown.style.display = "none";
      if (analysisDropdown) analysisDropdown.style.display = "none";
      var isOpen = addDataDropdown.style.display !== "none";
      addDataDropdown.style.display = isOpen ? "none" : "block";
      // Highlight active category
      if (!isOpen) {
        var active = typeof App.osmActiveCategory === "function" ? App.osmActiveCategory() : null;
        addDataDropdown.querySelectorAll("button[data-osm]").forEach(function (btn) {
          btn.classList.toggle("add-data-active", btn.getAttribute("data-osm") === active);
        });
        updateAddDataClearIcons();
      }
    });

    addDataDropdown.addEventListener("click", function (e) {
      // Road network download
      if (e.target.id === "road-net-download") {
        addDataDropdown.style.display = "none";
        if (typeof App.fetchRoadNetwork === "function") App.fetchRoadNetwork();
        return;
      }
      // OSM layer buttons
      var btn = e.target.closest("button[data-osm]");
      if (!btn) return;
      addDataDropdown.style.display = "none";
      var cat = btn.getAttribute("data-osm");
      if (typeof App.osmToggleCategory === "function") App.osmToggleCategory(cat);
    });

    // Close dropdowns on outside click or Escape
    document.addEventListener("click", function () {
      exportDropdown.style.display = "none";
      addDataDropdown.style.display = "none";
      if (analysisDropdown) analysisDropdown.style.display = "none";
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        exportDropdown.style.display = "none";
        addDataDropdown.style.display = "none";
        if (analysisDropdown) analysisDropdown.style.display = "none";
        if (typeof _closeFpSlider === "function") _closeFpSlider();
      }
    });

    // Checkbox change listeners — now wired in buffer-summary.js init()

    // Wrap render/rebuild functions to re-apply opacity + line width after layers are recreated
    (function () {
      function _wrapRender(fnName, applyFn) {
        var orig = App[fnName];
        if (typeof orig !== "function") return;
        App[fnName] = function () {
          orig.apply(this, arguments);
          applyFn();
        };
      }
      _wrapRender("rebuildBuffers",     function () { App.applyFeatureOpacity("buffer"); App.applyBufferLineWidth(); });
      _wrapRender("rebuildLineBuffers", function () { App.applyFeatureOpacity("buffer"); App.applyBufferLineWidth(); });
      _wrapRender("rebuildRouteBuffers",function () { App.applyFeatureOpacity("buffer"); App.applyBufferLineWidth(); });
      _wrapRender("renderPointLayers",  function () { App.applyFeatureOpacity("point");  App.applyLineWidth("point"); });
      _wrapRender("renderLineLayers",   function () { App.applyFeatureOpacity("line");   App.applyLineWidth("line"); });
      _wrapRender("renderRouteLayers",  function () { App.applyFeatureOpacity("route");  App.applyLineWidth("route"); });
      _wrapRender("renderPolygonLayers",function () { App.applyFeatureOpacity("polygon"); App.applyLineWidth("polygon"); });
    })();

    // Restore session: shared link takes priority over localStorage
    var _sharedLoaded = typeof App.cache !== "undefined" && App.cache.loadShareLink();
    if (_sharedLoaded) {
      notifyProject();
    } else if (typeof App.cache !== "undefined" && App.cache.restore()) {
      App.setStatus("Session restored");
      notifyProject();
    }

    // "Start fresh" link in view-only banner
    var _viewOnlyFreshBtn = document.getElementById("view-only-start-fresh");
    if (_viewOnlyFreshBtn) {
      _viewOnlyFreshBtn.addEventListener("click", function (e) {
        e.preventDefault();
        window.location.hash = "";
        window.location.reload();
      });
    }
  });
})();
